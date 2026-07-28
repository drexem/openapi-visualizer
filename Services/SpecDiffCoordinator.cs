using System.Diagnostics;
using OpenApiVisualizer.Models;

namespace OpenApiVisualizer.Services;

/// <summary>
/// Orchestrates "two commits in, one diff out": build both specs, import them into the store,
/// and hand back the existing <see cref="SpecDiffSummary"/> with provenance attached.
/// </summary>
public sealed class SpecDiffCoordinator
{
    private readonly SpecBundler _bundler;
    private readonly PullRequestResolver _pullRequests;
    private readonly OpenApiSpecStore _store;
    private readonly ILogger<SpecDiffCoordinator> _logger;

    public SpecDiffCoordinator(
        SpecBundler bundler,
        PullRequestResolver pullRequests,
        OpenApiSpecStore store,
        ILogger<SpecDiffCoordinator> logger)
    {
        _bundler = bundler;
        _pullRequests = pullRequests;
        _store = store;
        _logger = logger;
    }

    public SpecSourceOptions ResolveSource(string? name)
    {
        if (_bundler.Sources.Count == 0)
        {
            throw new SpecBuildException(
                "No spec sources are configured. Add a SpecDiff:Sources entry to appsettings.json.");
        }

        return _bundler.FindSource(name)
            ?? throw new SpecBuildException($"Unknown spec source '{name}'.");
    }

    public async Task<SpecDiffSummary> DiffRefsAsync(
        string? sourceName,
        string baseRef,
        string headRef,
        CancellationToken cancellationToken)
    {
        var source = ResolveSource(sourceName);

        var baseCommit = await _bundler.ResolveCommitAsync(source, baseRef, cancellationToken);
        var headCommit = await _bundler.ResolveCommitAsync(source, headRef, cancellationToken);

        if (string.Equals(baseCommit, headCommit, StringComparison.OrdinalIgnoreCase))
        {
            throw new SpecBuildException($"'{baseRef}' and '{headRef}' are the same commit - there is nothing to diff.");
        }

        return await BuildDiffAsync(
            source,
            baseCommit,
            headCommit,
            baseLabel: baseRef,
            headLabel: headRef,
            baseStrategy: "explicit refs",
            pullRequest: null,
            cancellationToken);
    }

    public async Task<SpecDiffSummary> DiffPullRequestAsync(
        string? sourceName,
        int pullRequestId,
        CancellationToken cancellationToken)
    {
        var source = ResolveSource(sourceName);
        var pullRequest = await _pullRequests.GetPullRequestAsync(source, pullRequestId, cancellationToken);

        _logger.LogInformation(
            "PR {Id} '{Title}': {Source} -> {Target}, mergeStatus={Status}",
            pullRequest.Id, pullRequest.Title, pullRequest.SourceBranch, pullRequest.TargetBranch, pullRequest.MergeStatus);

        // Best-effort fetch of everything we might need before choosing commits, so that
        // merge-base can be computed locally if the merge commit is unavailable.
        await FetchPullRequestRefsAsync(source, pullRequest, cancellationToken);

        var (baseCommit, headCommit, strategy) = await ChooseCommitsAsync(source, pullRequest, cancellationToken);

        await EnsurePresentAsync(source, baseCommit, "base", cancellationToken);
        await EnsurePresentAsync(source, headCommit, "head", cancellationToken);

        return await BuildDiffAsync(
            source,
            baseCommit,
            headCommit,
            baseLabel: pullRequest.TargetBranch,
            headLabel: pullRequest.SourceBranch,
            baseStrategy: strategy,
            pullRequest: pullRequest,
            cancellationToken);
    }

    /// <summary>
    /// Preferred comparison is "target branch tip" against "the merge result", which answers
    /// what merging this PR does to the API. When the PR cannot be merged cleanly there is no
    /// merge commit, so fall back to merge-base against the source head.
    /// </summary>
    private async Task<(string Base, string Head, string Strategy)> ChooseCommitsAsync(
        SpecSourceOptions source,
        PullRequestInfo pullRequest,
        CancellationToken cancellationToken)
    {
        if (!string.IsNullOrWhiteSpace(pullRequest.LastMergeCommit) &&
            !string.IsNullOrWhiteSpace(pullRequest.LastMergeTargetCommit) &&
            await _bundler.HasCommitAsync(source, pullRequest.LastMergeCommit, cancellationToken))
        {
            return (pullRequest.LastMergeTargetCommit,
                    pullRequest.LastMergeCommit,
                    "target tip vs merge result");
        }

        if (string.IsNullOrWhiteSpace(pullRequest.LastMergeSourceCommit))
        {
            throw new SpecBuildException(
                $"PR {pullRequest.Id} exposes neither a merge commit nor a source commit, so there is nothing to compare.");
        }

        var head = pullRequest.LastMergeSourceCommit;
        var target = pullRequest.LastMergeTargetCommit;

        if (!string.IsNullOrWhiteSpace(target))
        {
            var mergeBase = await _bundler.TryMergeBaseAsync(source, target, head, cancellationToken);
            if (!string.IsNullOrWhiteSpace(mergeBase))
            {
                var reason = string.Equals(pullRequest.MergeStatus, "conflicts", StringComparison.OrdinalIgnoreCase)
                    ? "merge-base vs source head (PR has conflicts)"
                    : "merge-base vs source head (no merge commit available)";
                return (mergeBase, head, reason);
            }

            return (target, head, "target tip vs source head (merge-base unavailable)");
        }

        throw new SpecBuildException($"PR {pullRequest.Id} has no target commit to compare against.");
    }

    private async Task FetchPullRequestRefsAsync(
        SpecSourceOptions source,
        PullRequestInfo pullRequest,
        CancellationToken cancellationToken)
    {
        var id = pullRequest.Id;

        // The merge commit lives only on the server-side pull-request ref, so it is almost
        // never present in a normal clone.
        var needsMerge = string.IsNullOrWhiteSpace(pullRequest.LastMergeCommit) ||
                         !await _bundler.HasCommitAsync(source, pullRequest.LastMergeCommit!, cancellationToken);
        if (needsMerge)
        {
            await _bundler.TryFetchAsync(source, $"+refs/pull/{id}/merge:refs/remotes/pr/{id}/merge", cancellationToken);
        }

        if (!string.IsNullOrWhiteSpace(pullRequest.LastMergeSourceCommit) &&
            !await _bundler.HasCommitAsync(source, pullRequest.LastMergeSourceCommit, cancellationToken))
        {
            await _bundler.TryFetchAsync(source, $"+refs/pull/{id}/head:refs/remotes/pr/{id}/head", cancellationToken);
        }

        if (!string.IsNullOrWhiteSpace(pullRequest.LastMergeTargetCommit) &&
            !await _bundler.HasCommitAsync(source, pullRequest.LastMergeTargetCommit, cancellationToken) &&
            pullRequest.TargetBranch != "(unknown)")
        {
            var branch = pullRequest.TargetBranch;
            await _bundler.TryFetchAsync(source, $"+refs/heads/{branch}:refs/remotes/pr-target/{branch}", cancellationToken);
        }
    }

    private async Task EnsurePresentAsync(
        SpecSourceOptions source,
        string commit,
        string role,
        CancellationToken cancellationToken)
    {
        if (await _bundler.HasCommitAsync(source, commit, cancellationToken))
        {
            return;
        }

        throw new SpecBuildException(
            $"The {role} commit {Short(commit)} is not in {source.RepoPath} and could not be fetched. " +
            "Check that the repository has a working remote and that you can reach it.");
    }

    private async Task<SpecDiffSummary> BuildDiffAsync(
        SpecSourceOptions source,
        string baseCommit,
        string headCommit,
        string baseLabel,
        string headLabel,
        string baseStrategy,
        PullRequestInfo? pullRequest,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();

        var (basePath, baseCached) = await _bundler.GetSpecAsync(source, baseCommit, cancellationToken);
        var (headPath, headCached) = await _bundler.GetSpecAsync(source, headCommit, cancellationToken);

        var baseSummary = await ImportAsync(basePath, $"{source.Name} @ {Short(baseCommit)}", makeCurrent: true, cancellationToken);
        var headSummary = await ImportAsync(headPath, $"{source.Name} @ {Short(headCommit)}", makeCurrent: false, cancellationToken);

        if (string.Equals(baseSummary.SpecId, headSummary.SpecId, StringComparison.Ordinal))
        {
            throw new SpecBuildException(
                $"The specs built from {Short(baseCommit)} and {Short(headCommit)} are byte-identical - " +
                "this change does not touch the API surface.");
        }

        var diff = _store.GetDiffSummary(baseSummary.SpecId, headSummary.SpecId)
            ?? throw new SpecBuildException("Both specs imported but the diff could not be produced.");

        diff.Provenance = new DiffProvenance
        {
            SourceName = source.Name,
            BaseLabel = baseLabel,
            BaseCommit = baseCommit,
            HeadLabel = headLabel,
            HeadCommit = headCommit,
            BaseStrategy = baseStrategy,
            PullRequestId = pullRequest?.Id,
            PullRequestTitle = pullRequest?.Title,
            SourceBranch = pullRequest?.SourceBranch,
            TargetBranch = pullRequest?.TargetBranch,
            BaseSummary = baseSummary,
            BaseFromCache = baseCached,
            HeadFromCache = headCached,
            PrepareSeconds = Math.Round(stopwatch.Elapsed.TotalSeconds, 1)
        };

        return diff;
    }

    private async Task<SpecSummary> ImportAsync(
        string path,
        string fileName,
        bool makeCurrent,
        CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(path);
        return makeCurrent
            ? await _store.ImportAsync(stream, fileName, cancellationToken)
            : await _store.ImportComparisonAsync(stream, fileName, cancellationToken);
    }

    private static string Short(string commit) => commit.Length > 8 ? commit[..8] : commit;
}
