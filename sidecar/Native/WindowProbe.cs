using System.Diagnostics;
using System.Runtime.InteropServices;
using JevSidecar.Protocol;

namespace JevSidecar.Native;

/// <summary>Reads what is in front of the user right now.</summary>
internal static class WindowProbe
{
    public static ForegroundWindowDto Foreground()
    {
        IntPtr window = NativeMethods.GetForegroundWindow();
        if (window == IntPtr.Zero)
        {
            throw new SidecarCommandException("no-foreground-window", "nothing currently holds the foreground");
        }

        _ = NativeMethods.GetWindowThreadProcessId(window, out uint processId);
        return new ForegroundWindowDto(
            ProcessId: (int)processId,
            ProcessName: ProcessName((int)processId),
            Title: WindowTitle(window),
            Bounds: ToDto(FrameBounds(window)));
    }

    /// <summary>The window's visible frame, falling back to the padded rectangle.</summary>
    public static NativeMethods.Rect FrameBounds(IntPtr window)
    {
        int hr = NativeMethods.DwmGetWindowAttribute(
            window,
            NativeMethods.DwmwaExtendedFrameBounds,
            out NativeMethods.Rect frame,
            Marshal.SizeOf<NativeMethods.Rect>());

        if (hr == 0 && frame.Width > 0 && frame.Height > 0)
        {
            return frame;
        }

        return NativeMethods.GetWindowRect(window, out NativeMethods.Rect fallback)
            ? fallback
            : throw new SidecarCommandException("window-bounds-unavailable", "the foreground window reported no bounds");
    }

    public static RectDto ToDto(NativeMethods.Rect rect) =>
        new(rect.Left, rect.Top, rect.Width, rect.Height);

    private static string WindowTitle(IntPtr window)
    {
        int length = NativeMethods.GetWindowTextLengthW(window);
        if (length <= 0)
        {
            return string.Empty;
        }

        char[] buffer = new char[length + 1];
        int written = NativeMethods.GetWindowTextW(window, buffer, buffer.Length);
        return written > 0 ? new string(buffer, 0, written) : string.Empty;
    }

    private static string ProcessName(int processId)
    {
        try
        {
            using Process process = Process.GetProcessById(processId);
            return process.ProcessName;
        }
        catch (ArgumentException)
        {
            // The process exited between the window query and this lookup.
            return "unknown";
        }
        catch (InvalidOperationException)
        {
            return "unknown";
        }
    }
}
