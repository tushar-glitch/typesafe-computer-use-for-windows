using System.Runtime.InteropServices;

namespace JevSidecar.Native;

/// <summary>Raw Win32 entry points. Nothing here interprets anything.</summary>
internal static class NativeMethods
{
    internal const int DwmwaExtendedFrameBounds = 9;

    /// <summary>Per-monitor DPI awareness, v2. Win10 1703 and newer.</summary>
    internal static readonly IntPtr DpiAwarenessContextPerMonitorAwareV2 = new(-4);

    [StructLayout(LayoutKind.Sequential)]
    internal struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public readonly int Width => Right - Left;

        public readonly int Height => Bottom - Top;
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern int GetWindowTextW(IntPtr window, char[] text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetWindowTextLengthW(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetWindowRect(IntPtr window, out Rect rect);

    [DllImport("user32.dll")]
    internal static extern uint GetDpiForWindow(IntPtr window);

    [DllImport("user32.dll")]
    internal static extern int GetSystemMetrics(int index);

    /// <summary>
    /// The visible frame, excluding the invisible resize border Windows 10 adds.
    /// GetWindowRect over-reports by several pixels on every side; cropping an
    /// OCR region to that padded rectangle wastes pixels and clips neighbours in.
    /// </summary>
    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect value, int size);
}
