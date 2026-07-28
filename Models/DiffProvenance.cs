namespace OpenApiVisualizer.Models;

/// <summary>
/// What was actually compared. Two large specs render identically whether or not the right
/// commits were used, so this travels with every prepared diff and is shown in the UI.
/// </summary>
public sealed class DiffProvenance
{
    public required string SourceName { get; init; }

    public required string BaseLabel { get; init; }
    public required string BaseCommit { get; init; }
    public required string HeadLabel { get; init; }
    public required string HeadCommit { get; init; }

    /// <summary>How the base commit was chosen, e.g. "target branch tip" or "merge-base (PR has conflicts)".</summary>
    public required string BaseStrategy { get; init; }

    public int? PullRequestId { get; init; }
    public string? PullRequestTitle { get; init; }
    public string? SourceBranch { get; init; }
    public string? TargetBranch { get; init; }

    /// <summary>Summary of the base spec; the diff itself only carries the compare summary.</summary>
    public SpecSummary? BaseSummary { get; init; }

    public bool BaseFromCache { get; init; }
    public bool HeadFromCache { get; init; }
    public double PrepareSeconds { get; init; }
}

public sealed record PullRequestInfo(
    int Id,
    string Title,
    string SourceBranch,
    string TargetBranch,
    string? LastMergeSourceCommit,
    string? LastMergeTargetCommit,
    string? LastMergeCommit,
    string? MergeStatus);
