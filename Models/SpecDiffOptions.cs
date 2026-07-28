namespace OpenApiVisualizer.Models;

/// <summary>
/// Configuration for building OpenAPI specs straight out of a git repository.
/// The visualizer knows nothing about how a given repo produces its spec - each
/// source declares which paths to extract and which commands turn them into a
/// single self-contained document.
/// </summary>
public sealed class SpecDiffOptions
{
    public const string SectionName = "SpecDiff";

    /// <summary>Where built specs are cached, keyed by commit. Defaults to a temp subdirectory.</summary>
    public string? CacheDirectory { get; set; }

    /// <summary>Per-command timeout for git and the build steps.</summary>
    public int StepTimeoutSeconds { get; set; } = 300;

    public List<SpecSourceOptions> Sources { get; set; } = [];
}

public sealed class SpecSourceOptions
{
    /// <summary>Display name, also the key callers pass in and the cache subdirectory.</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Absolute path to the git repository (working copy is never modified).</summary>
    public string RepoPath { get; set; } = string.Empty;

    /// <summary>
    /// Working directory for the build steps. Defaults to <see cref="RepoPath"/>, which is what
    /// dotnet local tools need in order to resolve their manifest.
    /// </summary>
    public string? WorkingDirectory { get; set; }

    /// <summary>Pathspecs handed to <c>git archive</c>. Keep these narrow - this is the speed win.</summary>
    public List<string> ArchivePaths { get; set; } = [];

    /// <summary>
    /// Commands run in order to turn the extracted tree into one spec file. Supported placeholders:
    /// <c>{tree}</c> extracted archive root, <c>{work}</c> scratch directory for intermediates,
    /// <c>{output}</c> the file the final step should write, <c>{repo}</c> the repository path.
    /// <para>May be empty when the repository already commits a single self-contained spec; in that
    /// case set <see cref="SpecFile"/> to point at it.</para>
    /// </summary>
    public List<SpecBuildStep> Steps { get; set; } = [];

    /// <summary>
    /// Where the finished spec ends up. Defaults to <c>{output}</c>, meaning the last step wrote it.
    /// Point this into <c>{tree}</c> to use a spec that is committed as-is, with no build steps.
    /// Supports the same placeholders as <see cref="Steps"/>.
    /// </summary>
    public string? SpecFile { get; set; }

    /// <summary>Optional Azure DevOps details, required only for pull-request lookup.</summary>
    public AzureDevOpsOptions? Ado { get; set; }

    public string ResolveWorkingDirectory() =>
        string.IsNullOrWhiteSpace(WorkingDirectory) ? RepoPath : WorkingDirectory;
}

public sealed class SpecBuildStep
{
    public string Command { get; set; } = string.Empty;
    public string Arguments { get; set; } = string.Empty;
}

public sealed class AzureDevOpsOptions
{
    /// <summary>Collection URL, e.g. <c>https://tfs.example.com/DefaultCollection</c>.</summary>
    public string CollectionUrl { get; set; } = string.Empty;

    public string Project { get; set; } = string.Empty;

    public string Repository { get; set; } = string.Empty;

    public string ApiVersion { get; set; } = "6.0";

    /// <summary>
    /// Environment variable holding a PAT. When unset or empty the client falls back to the
    /// current Windows identity, which is usually enough for on-prem Azure DevOps Server.
    /// </summary>
    public string PatEnvironmentVariable { get; set; } = "ADO_PAT";

    /// <summary>Git remote used to fetch pull-request refs.</summary>
    public string Remote { get; set; } = "origin";
}
