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

    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;
    private const int SmXVirtualScreen = 76;
    private const int SmYVirtualScreen = 77;
    private const int SmCxVirtualScreen = 78;
    private const int SmCyVirtualScreen = 79;

    /// <summary>The primary monitor only, always anchored at the origin.</summary>
    internal static Rect PrimaryScreen() => new()
    {
        Left = 0,
        Top = 0,
        Right = GetSystemMetrics(SmCxScreen),
        Bottom = GetSystemMetrics(SmCyScreen),
    };

    /// <summary>
    /// The rectangle enclosing every monitor.
    ///
    /// Not the primary screen, and not anchored at the origin: a monitor placed
    /// above or to the left of the primary one occupies negative coordinates.
    /// Treating the primary display as the whole world makes every window on a
    /// secondary monitor look off-screen, which silently prunes them from the
    /// accessibility walk.
    /// </summary>
    internal static Rect VirtualScreen()
    {
        int x = GetSystemMetrics(SmXVirtualScreen);
        int y = GetSystemMetrics(SmYVirtualScreen);
        int width = GetSystemMetrics(SmCxVirtualScreen);
        int height = GetSystemMetrics(SmCyVirtualScreen);

        // A single-monitor machine can report zeroes for the virtual metrics.
        return width > 0 && height > 0
            ? new Rect { Left = x, Top = y, Right = x + width, Bottom = y + height }
            : PrimaryScreen();
    }

    /// <summary>
    /// The visible frame, excluding the invisible resize border Windows 10 adds.
    /// GetWindowRect over-reports by several pixels on every side; cropping an
    /// OCR region to that padded rectangle wastes pixels and clips neighbours in.
    /// </summary>
    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect value, int size);
}
