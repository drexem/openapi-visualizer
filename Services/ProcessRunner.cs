using System.Diagnostics;
using System.Text;

namespace OpenApiVisualizer.Services;

public sealed record ProcessResult(int ExitCode, string StdOut, string StdErr)
{
    public bool Succeeded => ExitCode == 0;

    /// <summary>Trailing output, for error messages - tool failures put the useful part at the end.</summary>
    public string Tail(int lines = 12)
    {
        var combined = string.Join('\n', new[] { StdOut, StdErr }.Where(s => !string.IsNullOrWhiteSpace(s)));
        var all = combined.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        return string.Join('\n', all.TakeLast(lines).Select(line => line.TrimEnd()));
    }
}

public static class ProcessRunner
{
    public static Task<ProcessResult> RunAsync(
        string fileName,
        IEnumerable<string> arguments,
        string workingDirectory,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var startInfo = CreateStartInfo(fileName, workingDirectory);
        foreach (var argument in arguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        return ExecuteAsync(startInfo, timeout, cancellationToken);
    }

    /// <summary>
    /// Runs a command whose arguments come from configuration as a single pre-quoted string.
    /// Only use this for trusted, operator-authored input.
    /// </summary>
    public static Task<ProcessResult> RunRawAsync(
        string fileName,
        string arguments,
        string workingDirectory,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var startInfo = CreateStartInfo(fileName, workingDirectory);
        startInfo.Arguments = arguments;
        return ExecuteAsync(startInfo, timeout, cancellationToken);
    }

    private static ProcessStartInfo CreateStartInfo(string fileName, string workingDirectory) => new()
    {
        FileName = fileName,
        WorkingDirectory = workingDirectory,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
        CreateNoWindow = true,
        StandardOutputEncoding = Encoding.UTF8,
        StandardErrorEncoding = Encoding.UTF8
    };

    private static async Task<ProcessResult> ExecuteAsync(
        ProcessStartInfo startInfo,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        using var process = new Process { StartInfo = startInfo };

        try
        {
            process.Start();
        }
        catch (Exception ex)
        {
            throw new SpecBuildException($"Failed to start '{startInfo.FileName}': {ex.Message}", ex);
        }

        // Drain both pipes before waiting, otherwise a chatty child can fill its buffer and hang.
        var stdOutTask = process.StandardOutput.ReadToEndAsync(CancellationToken.None);
        var stdErrTask = process.StandardError.ReadToEndAsync(CancellationToken.None);

        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(timeout);

        try
        {
            await process.WaitForExitAsync(timeoutCts.Token);
        }
        catch (OperationCanceledException)
        {
            TryKill(process);
            cancellationToken.ThrowIfCancellationRequested();
            throw new SpecBuildException(
                $"'{startInfo.FileName}' did not finish within {timeout.TotalSeconds:0}s and was terminated.");
        }

        return new ProcessResult(process.ExitCode, await stdOutTask, await stdErrTask);
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
        }
        catch
        {
            // Nothing useful to do if the process is already gone or unkillable.
        }
    }
}

/// <summary>Raised for failures that are worth showing the user verbatim.</summary>
public sealed class SpecBuildException : Exception
{
    public SpecBuildException(string message) : base(message)
    {
    }

    public SpecBuildException(string message, Exception inner) : base(message, inner)
    {
    }
}
