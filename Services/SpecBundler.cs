using System.Diagnostics;
using System.Formats.Tar;
using Microsoft.Extensions.Options;
using OpenApiVisualizer.Models;

namespace OpenApiVisualizer.Services;

/// <summary>
/// Produces a single self-contained OpenAPI document for an arbitrary commit by extracting the
/// spec sources with <c>git archive</c> and running the source's configured build steps.
/// <para>
/// The repository working copy is never touched - <c>git archive</c> is a read-only plumbing
/// command, so this is safe to run against a clone the user is actively working in.
/// </para>
/// </summary>
public sealed class SpecBundler
{
    private readonly SpecDiffOptions _options;
    private readonly ILogger<SpecBundler> _logger;
    private readonly SemaphoreSlim _buildGate = new(1, 1);
    private readonly string _cacheRoot;

    public SpecBundler(IOptions<SpecDiffOptions> options, ILogger<SpecBundler> logger)
    {
        _options = options.Value;
        _logger = logger;
        _cacheRoot = string.IsNullOrWhiteSpace(_options.CacheDirectory)
            ? Path.Combine(Path.GetTempPath(), "oav")
            : _options.CacheDirectory;
    }

    private TimeSpan Timeout => TimeSpan.FromSeconds(Math.Clamp(_options.StepTimeoutSeconds, 10, 3600));

    public IReadOnlyList<SpecSourceOptions> Sources => _options.Sources;

    public SpecSourceOptions? FindSource(string? name)
    {
        if (_options.Sources.Count == 0)
        {
            return null;
        }

        return string.IsNullOrWhiteSpace(name)
            ? _options.Sources[0]
            : _options.Sources.FirstOrDefault(source =>
                string.Equals(source.Name, name, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Resolves a branch, tag, or sha to a full commit id.</summary>
    public async Task<string> ResolveCommitAsync(SpecSourceOptions source, string revision, CancellationToken cancellationToken)
    {
        var result = await GitAsync(source, ["rev-parse", "--verify", "--end-of-options", $"{revision}^{{commit}}"], cancellationToken);
        if (!result.Succeeded)
        {
            throw new SpecBuildException($"Cannot resolve '{revision}' in {source.RepoPath}. {result.Tail(4)}");
        }

        return result.StdOut.Trim();
    }

    public async Task<bool> HasCommitAsync(SpecSourceOptions source, string commit, CancellationToken cancellationToken)
    {
        var result = await GitAsync(source, ["cat-file", "-e", $"{commit}^{{commit}}"], cancellationToken);
        return result.Succeeded;
    }

    public async Task<bool> TryFetchAsync(SpecSourceOptions source, string refSpec, CancellationToken cancellationToken)
    {
        var remote = source.Ado?.Remote ?? "origin";
        _logger.LogInformation("Fetching {RefSpec} from {Remote}", refSpec, remote);
        var result = await GitAsync(source, ["fetch", "--no-tags", remote, refSpec], cancellationToken);
        if (!result.Succeeded)
        {
            _logger.LogWarning("Fetch of {RefSpec} failed: {Error}", refSpec, result.Tail(4));
        }

        return result.Succeeded;
    }

    public async Task<string?> TryMergeBaseAsync(SpecSourceOptions source, string a, string b, CancellationToken cancellationToken)
    {
        var result = await GitAsync(source, ["merge-base", a, b], cancellationToken);
        return result.Succeeded ? result.StdOut.Trim() : null;
    }

    /// <summary>
    /// Returns the path to a built spec for <paramref name="commit"/>, building it if it is not
    /// already cached. Commits are immutable, so a cache hit needs no validation.
    /// </summary>
    public async Task<(string Path, bool FromCache)> GetSpecAsync(
        SpecSourceOptions source,
        string commit,
        CancellationToken cancellationToken)
    {
        var cachePath = GetCachePath(source, commit);
        if (File.Exists(cachePath) && new FileInfo(cachePath).Length > 0)
        {
            return (cachePath, true);
        }

        await _buildGate.WaitAsync(cancellationToken);
        try
        {
            // Another request may have built it while we waited for the gate.
            if (File.Exists(cachePath) && new FileInfo(cachePath).Length > 0)
            {
                return (cachePath, true);
            }

            await BuildAsync(source, commit, cachePath, cancellationToken);
            return (cachePath, false);
        }
        finally
        {
            _buildGate.Release();
        }
    }

    private async Task BuildAsync(
        SpecSourceOptions source,
        string commit,
        string cachePath,
        CancellationToken cancellationToken)
    {
        if (source.ArchivePaths.Count == 0)
        {
            throw new SpecBuildException($"Source '{source.Name}' declares no archivePaths.");
        }

        if (source.Steps.Count == 0 && string.IsNullOrWhiteSpace(source.SpecFile))
        {
            throw new SpecBuildException(
                $"Source '{source.Name}' declares neither build steps nor a specFile, so there is " +
                "nothing to produce a spec from.");
        }

        // Work paths stay deliberately short: extracted schema filenames are long and Windows
        // still enforces MAX_PATH for many tools. Override CacheDirectory if this ever bites.
        var workDir = Path.Combine(_cacheRoot, "w", commit[..8]);
        var treeDir = Path.Combine(workDir, "t");
        var outputPath = Path.Combine(workDir, "spec.json");

        DeleteDirectory(workDir);
        Directory.CreateDirectory(treeDir);

        var stopwatch = Stopwatch.StartNew();
        try
        {
            await ExtractAsync(source, commit, workDir, treeDir, cancellationToken);
            await RunStepsAsync(source, treeDir, workDir, outputPath, cancellationToken);

            var producedPath = string.IsNullOrWhiteSpace(source.SpecFile)
                ? outputPath
                : Substitute(source.SpecFile, treeDir, workDir, outputPath, source.RepoPath);

            if (!File.Exists(producedPath) || new FileInfo(producedPath).Length == 0)
            {
                throw new SpecBuildException(string.IsNullOrWhiteSpace(source.SpecFile)
                    ? $"Source '{source.Name}' ran its build steps but produced no output. " +
                      "The final step must write to {output}, or set specFile instead."
                    : $"Source '{source.Name}' produced no spec at its configured specFile: {source.SpecFile}");
            }

            Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
            File.Move(producedPath, cachePath, overwrite: true);

            _logger.LogInformation(
                "Built spec for {Source} at {Commit} in {Elapsed:0.0}s ({Size:N0} bytes)",
                source.Name, commit[..8], stopwatch.Elapsed.TotalSeconds, new FileInfo(cachePath).Length);
        }
        finally
        {
            DeleteDirectory(workDir);
        }
    }

    private async Task ExtractAsync(
        SpecSourceOptions source,
        string commit,
        string workDir,
        string treeDir,
        CancellationToken cancellationToken)
    {
        var tarPath = Path.Combine(workDir, "a.tar");

        var arguments = new List<string> { "archive", "--format=tar", $"--output={tarPath}", commit, "--" };
        arguments.AddRange(source.ArchivePaths);

        var result = await GitAsync(source, arguments, cancellationToken);
        if (!result.Succeeded)
        {
            throw new SpecBuildException(
                $"git archive failed for {commit[..8]}. Do all archivePaths exist at that commit?\n{result.Tail(6)}");
        }

        await TarFile.ExtractToDirectoryAsync(tarPath, treeDir, overwriteFiles: true, cancellationToken);
        File.Delete(tarPath);
    }

    private async Task RunStepsAsync(
        SpecSourceOptions source,
        string treeDir,
        string workDir,
        string outputPath,
        CancellationToken cancellationToken)
    {
        var workingDirectory = source.ResolveWorkingDirectory();
        for (var index = 0; index < source.Steps.Count; index++)
        {
            var step = source.Steps[index];
            var arguments = Substitute(step.Arguments, treeDir, workDir, outputPath, source.RepoPath);

            var result = await ProcessRunner.RunRawAsync(
                step.Command, arguments, workingDirectory, Timeout, cancellationToken);

            if (!result.Succeeded)
            {
                throw new SpecBuildException(
                    $"Step {index + 1} of '{source.Name}' failed (exit {result.ExitCode}): " +
                    $"{step.Command} {arguments}\n{result.Tail()}");
            }
        }
    }

    private static string Substitute(string template, string treeDir, string workDir, string outputPath, string repoPath) =>
        template
            .Replace("{tree}", Normalize(treeDir), StringComparison.Ordinal)
            .Replace("{work}", Normalize(workDir), StringComparison.Ordinal)
            .Replace("{output}", Normalize(outputPath), StringComparison.Ordinal)
            .Replace("{repo}", Normalize(repoPath), StringComparison.Ordinal);

    // Forward slashes work for git, dotnet tools and .NET itself on Windows, and avoid
    // backslash-escaping surprises inside the configured argument strings.
    private static string Normalize(string path) => path.Replace('\\', '/');

    private Task<ProcessResult> GitAsync(
        SpecSourceOptions source,
        IEnumerable<string> arguments,
        CancellationToken cancellationToken)
    {
        if (!Directory.Exists(source.RepoPath))
        {
            throw new SpecBuildException($"Source '{source.Name}' points at a missing repoPath: {source.RepoPath}");
        }

        return ProcessRunner.RunAsync("git", arguments, source.RepoPath, Timeout, cancellationToken);
    }

    private string GetCachePath(SpecSourceOptions source, string commit)
    {
        var folder = string.Concat(source.Name.Select(c =>
            char.IsLetterOrDigit(c) ? char.ToLowerInvariant(c) : '-'));
        return Path.Combine(_cacheRoot, "c", folder, $"{commit}.json");
    }

    private static void DeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                Directory.Delete(path, recursive: true);
            }
        }
        catch (IOException)
        {
            // Leftovers are harmless - the next build overwrites files anyway.
        }
    }
}
