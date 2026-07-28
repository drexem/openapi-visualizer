using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using OpenApiVisualizer.Models;

namespace OpenApiVisualizer.Services;

/// <summary>
/// Turns a pull-request number into the two commits worth comparing.
/// Works against both Azure DevOps Services and on-prem Azure DevOps Server / TFS.
/// </summary>
public sealed class PullRequestResolver
{
    public const string HttpClientName = "ado";

    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<PullRequestResolver> _logger;

    public PullRequestResolver(IHttpClientFactory httpClientFactory, ILogger<PullRequestResolver> logger)
    {
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    public async Task<PullRequestInfo> GetPullRequestAsync(
        SpecSourceOptions source,
        int pullRequestId,
        CancellationToken cancellationToken)
    {
        var ado = source.Ado
            ?? throw new SpecBuildException($"Source '{source.Name}' has no 'ado' section, so pull requests cannot be resolved.");

        var url = $"{ado.CollectionUrl.TrimEnd('/')}/{ado.Project}/_apis/git/repositories/{ado.Repository}" +
                  $"/pullRequests/{pullRequestId}?api-version={ado.ApiVersion}";

        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        ApplyAuthentication(request, ado);

        using var client = _httpClientFactory.CreateClient(HttpClientName);

        HttpResponseMessage response;
        try
        {
            response = await client.SendAsync(request, cancellationToken);
        }
        catch (HttpRequestException ex)
        {
            throw new SpecBuildException($"Could not reach Azure DevOps at {ado.CollectionUrl}: {ex.Message}", ex);
        }

        using (response)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                throw new SpecBuildException(
                    $"Azure DevOps rejected the request ({(int)response.StatusCode}). " +
                    $"Set the {ado.PatEnvironmentVariable} environment variable to a PAT with Code (read) scope.");
            }

            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                throw new SpecBuildException(
                    $"Pull request {pullRequestId} was not found in {ado.Project}/{ado.Repository}.");
            }

            if (!response.IsSuccessStatusCode)
            {
                throw new SpecBuildException(
                    $"Azure DevOps returned {(int)response.StatusCode} for pull request {pullRequestId}.");
            }

            // A non-JSON body here almost always means an HTML sign-in page rather than an API response.
            var payload = await response.Content.ReadAsStringAsync(cancellationToken);
            if (payload.StartsWith('<'))
            {
                throw new SpecBuildException(
                    "Azure DevOps returned an HTML page instead of JSON, which usually means authentication " +
                    $"was silently redirected. Set {ado.PatEnvironmentVariable} to a PAT and retry.");
            }

            using var document = JsonDocument.Parse(payload);
            return Parse(document.RootElement, pullRequestId);
        }
    }

    private static PullRequestInfo Parse(JsonElement root, int pullRequestId) => new(
        Id: pullRequestId,
        Title: GetString(root, "title") ?? $"Pull request {pullRequestId}",
        SourceBranch: ShortenRef(GetString(root, "sourceRefName")),
        TargetBranch: ShortenRef(GetString(root, "targetRefName")),
        LastMergeSourceCommit: GetCommitId(root, "lastMergeSourceCommit"),
        LastMergeTargetCommit: GetCommitId(root, "lastMergeTargetCommit"),
        LastMergeCommit: GetCommitId(root, "lastMergeCommit"),
        MergeStatus: GetString(root, "mergeStatus"));

    private void ApplyAuthentication(HttpRequestMessage request, AzureDevOpsOptions ado)
    {
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        var pat = Environment.GetEnvironmentVariable(ado.PatEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(pat))
        {
            // No PAT: rely on the handler's default Windows credentials, which is the common
            // case for on-prem servers reached from a domain-joined machine.
            _logger.LogDebug("No {Variable} set; using default credentials for {Url}",
                ado.PatEnvironmentVariable, ado.CollectionUrl);
            return;
        }

        var token = Convert.ToBase64String(Encoding.ASCII.GetBytes($":{pat}"));
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", token);
    }

    private static string? GetString(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static string? GetCommitId(JsonElement element, string property) =>
        element.TryGetProperty(property, out var commit) && commit.ValueKind == JsonValueKind.Object
            ? GetString(commit, "commitId")
            : null;

    private static string ShortenRef(string? refName)
    {
        if (string.IsNullOrWhiteSpace(refName))
        {
            return "(unknown)";
        }

        return refName.StartsWith("refs/heads/", StringComparison.Ordinal)
            ? refName["refs/heads/".Length..]
            : refName;
    }
}
