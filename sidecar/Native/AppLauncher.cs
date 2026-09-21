using System.Diagnostics;
using System.Runtime.InteropServices;
using JevSidecar.Protocol;

namespace JevSidecar.Native;

/// <summary>
/// Starting, focusing and navigating applications.
///
/// These are the fast path. Launching an app or opening a URL is an operating
/// system call measured in milliseconds, where reaching the same place by
/// reading the screen and clicking costs seconds per step. Anything expressible
/// here should never go through the perception loop.
/// </summary>
internal static class AppLauncher
{
    private const int SwRestore = 9;

    /// <summary>How long to wait for a window to come forward before calling it a failure.</summary>
    private static readonly TimeSpan ActivationTimeout = TimeSpan.FromSeconds(3);

    /// <summary>
    /// Start an application by name or path.
    ///
    /// Resolution is left to the shell, which consults the App Paths registry,
    /// so bare names like "notepad" or "chrome" work without hard-coded paths.
    /// No arguments are ever passed: the name is handed over as a single value
    /// rather than composed into a command line, so nothing in it can be
    /// reinterpreted as further arguments or shell syntax.
    /// </summary>
    public static bool Launch(string appId)
    {
        string trimmed = appId.Trim();
        if (trimmed.Length == 0)
        {
            throw new SidecarCommandException("bad-app", "no application was named");
        }

        try
        {
            using Process? started = Process.Start(new ProcessStartInfo(trimmed) { UseShellExecute = true });
            return true;
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new SidecarCommandException("launch-failed", $"could not start '{trimmed}': {error.Message}");
        }
        catch (InvalidOperationException error)
        {
            throw new SidecarCommandException("launch-failed", $"could not start '{trimmed}': {error.Message}");
        }
    }

    /// <summary>
    /// Open a web address in the default browser.
    ///
    /// Only http and https are accepted. Handing an arbitrary string to the
    /// shell would let any registered protocol handler be invoked, which is a
    /// far larger capability than opening a page.
    /// </summary>
    public static bool OpenUrl(string url)
    {
        string trimmed = url.Trim();
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out Uri? parsed)
            || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        {
            throw new SidecarCommandException("bad-url", $"'{trimmed}' is not an http or https URL");
        }

        try
        {
            using Process? started = Process.Start(new ProcessStartInfo(parsed.AbsoluteUri) { UseShellExecute = true });
            return true;
        }
        catch (System.ComponentModel.Win32Exception error)
        {
            throw new SidecarCommandException("open-failed", $"could not open '{parsed.AbsoluteUri}': {error.Message}");
        }
    }

    /// <summary>
    /// Bring a running application forward, restoring it if minimised.
    ///
    /// Confirmed rather than assumed: Windows refuses foreground changes from a
    /// process that does not currently own it, silently, so the only way to
    /// know the window actually came forward is to look afterwards.
    /// </summary>
    public static bool Activate(string processName)
    {
        string trimmed = processName.Trim();
        if (trimmed.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
        {
            trimmed = trimmed[..^4];
        }

        IntPtr window = MainWindowOf(trimmed);
        if (window == IntPtr.Zero)
        {
            return false;
        }

        if (NativeMethods.IsIconic(window))
        {
            _ = NativeMethods.ShowWindow(window, SwRestore);
        }

        _ = NativeMethods.SetForegroundWindow(window);

        DateTime deadline = DateTime.UtcNow + ActivationTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (NativeMethods.GetForegroundWindow() == window)
            {
                return true;
            }

            Thread.Sleep(50);
        }

        return false;
    }

    private static IntPtr MainWindowOf(string processName)
    {
        Process[] candidates;
        try
        {
            candidates = Process.GetProcessesByName(processName);
        }
        catch (InvalidOperationException)
        {
            return IntPtr.Zero;
        }

        try
        {
            foreach (Process process in candidates)
            {
                if (process.MainWindowHandle != IntPtr.Zero)
                {
                    return process.MainWindowHandle;
                }
            }
        }
        catch (COMException)
        {
            return IntPtr.Zero;
        }
        finally
        {
            foreach (Process process in candidates)
            {
                process.Dispose();
            }
        }

        return IntPtr.Zero;
    }
}
