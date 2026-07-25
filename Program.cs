using Microsoft.AspNetCore.Http.Features;
using OpenApiVisualizer.Models;
using OpenApiVisualizer.Services;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<OpenApiSpecStore>();
builder.Services.Configure<FormOptions>(options =>
{
    options.MultipartBodyLengthLimit = 250L * 1024L * 1024L;
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

app.MapPost("/api/specs/{specId}/graph", (string specId, GraphRequest request, OpenApiSpecStore store) =>
{
    return Results.Ok(store.BuildGraph(specId, request));
});

app.Run();
