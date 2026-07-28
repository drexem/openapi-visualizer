using Microsoft.AspNetCore.Http.Features;
using OpenApiVisualizer.Models;
using OpenApiVisualizer.Services;

var builder = WebApplication.CreateBuilder(args);

// Local, untracked overrides. Spec sources point at paths and hosts that are specific to whoever
// is running the tool, so they belong here rather than in the committed appsettings.json.
// See appsettings.Local.example.json.
builder.Configuration.AddJsonFile("appsettings.Local.json", optional: true, reloadOnChange: true);

builder.Services.AddSingleton<OpenApiSpecStore>();
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 250L * 1024L * 1024L;
});

builder.Services.Configure<SpecDiffOptions>(builder.Configuration.GetSection(SpecDiffOptions.SectionName));
builder.Services.AddSingleton<SpecBundler>();
builder.Services.AddSingleton<PullRequestResolver>();
builder.Services.AddSingleton<SpecDiffCoordinator>();

// Default credentials cover on-prem Azure DevOps Server from a domain-joined machine;
// a PAT, when present, is applied per request and takes precedence.
builder.Services.AddHttpClient(PullRequestResolver.HttpClientName)
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
        UseDefaultCredentials = true,
        PreAuthenticate = true
    });

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapPost("/api/specs/import", async (HttpRequest request, OpenApiSpecStore store, CancellationToken cancellationToken) =>
{
    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "Upload a JSON OpenAPI file as multipart/form-data." });
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
    if (file is null || file.Length == 0)
    {
        return Results.BadRequest(new { error = "No file was uploaded." });
    }

    await using var stream = file.OpenReadStream();
    var summary = await store.ImportAsync(stream, file.FileName, cancellationToken);
    return Results.Ok(summary);
});

app.MapPost("/api/specs/{specId}/compare", async (string specId, HttpRequest request, OpenApiSpecStore store, CancellationToken cancellationToken) =>
{
    if (store.GetSummary(specId) is null)
    {
        return Results.NotFound(new { error = $"Base spec '{specId}' is not loaded." });
    }

    if (!request.HasFormContentType)
    {
        return Results.BadRequest(new { error = "Upload a JSON OpenAPI file as multipart/form-data." });
    }

    var form = await request.ReadFormAsync(cancellationToken);
    var file = form.Files.GetFile("file") ?? form.Files.FirstOrDefault();
    if (file is null || file.Length == 0)
    {
        return Results.BadRequest(new { error = "No file was uploaded." });
    }

    await using var stream = file.OpenReadStream();
    var compareSummary = await store.ImportComparisonAsync(stream, file.FileName, cancellationToken);
    var diff = store.GetDiffSummary(specId, compareSummary.SpecId);
    return diff is null
        ? Results.NotFound(new { error = "Unable to compare the selected specs." })
        : Results.Ok(diff);
});

app.MapGet("/api/specs/current", (OpenApiSpecStore store) =>
{
    return store.CurrentSpecId is null
        ? Results.NotFound(new { error = "No spec is loaded." })
        : Results.Ok(store.GetSummary(store.CurrentSpecId));
});

app.MapGet("/api/specs/{specId}/endpoints", (
    string specId,
    string? query,
    string? method,
    int? limit,
    OpenApiSpecStore store) =>
{
    return Results.Ok(store.SearchEndpoints(specId, query, method, limit ?? 100));
});

app.MapGet("/api/specs/{specId}/schemas", (string specId, string? schemaId, string? compareSpecId, OpenApiSpecStore store) =>
{
    if (string.IsNullOrWhiteSpace(schemaId))
    {
        return Results.BadRequest(new { error = "Provide a schemaId query parameter." });
    }

    var schema = store.GetSchema(specId, schemaId, compareSpecId);
    return schema is null
        ? Results.NotFound(new { error = $"Schema '{schemaId}' was not found." })
        : Results.Ok(schema);
});

app.MapPost("/api/specs/{specId}/graph", (string specId, GraphRequest request, OpenApiSpecStore store) =>
{
    return Results.Ok(store.BuildGraph(specId, request));
});

app.MapGet("/api/diff/sources", (SpecBundler bundler) =>
{
    return Results.Ok(bundler.Sources.Select(source => new
    {
        name = source.Name,
        supportsPullRequests = source.Ado is not null
    }));
});

app.MapPost("/api/diff/from-refs", async (
    RefDiffRequest request,
    SpecDiffCoordinator coordinator,
    CancellationToken cancellationToken) =>
{
    if (string.IsNullOrWhiteSpace(request.BaseRef) || string.IsNullOrWhiteSpace(request.HeadRef))
    {
        return Results.BadRequest(new { error = "Provide both baseRef and headRef." });
    }

    return await RunAsync(() => coordinator.DiffRefsAsync(
        request.Source, request.BaseRef.Trim(), request.HeadRef.Trim(), cancellationToken));
});

app.MapPost("/api/diff/from-pr", async (
    PullRequestDiffRequest request,
    SpecDiffCoordinator coordinator,
    CancellationToken cancellationToken) =>
{
    if (request.PullRequestId <= 0)
    {
        return Results.BadRequest(new { error = "Provide a positive pullRequestId." });
    }

    return await RunAsync(() => coordinator.DiffPullRequestAsync(
        request.Source, request.PullRequestId, cancellationToken));
});

// Build failures are expected traffic here (bad ref, unreachable server, failing merge tool),
// so surface the message instead of a 500 with a stack trace.
static async Task<IResult> RunAsync(Func<Task<SpecDiffSummary>> action)
{
    try
    {
        return Results.Ok(await action());
    }
    catch (SpecBuildException ex)
    {
        return Results.BadRequest(new { error = ex.Message });
    }
}

app.Run();

internal sealed record RefDiffRequest(string? Source, string? BaseRef, string? HeadRef);

internal sealed record PullRequestDiffRequest(string? Source, int PullRequestId);
