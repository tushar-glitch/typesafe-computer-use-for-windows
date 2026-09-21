using System.Drawing;
using System.Drawing.Imaging;
using JevSidecar.Protocol;

namespace JevSidecar.Native;

/// <summary>
/// Pixels off the screen.
///
/// Uses CopyFromScreen rather than PrintWindow: it returns what is actually on
/// the display, including hardware-composited and GPU-rendered content that
/// PrintWindow hands back as a blank or black rectangle. The trade-off is that
/// it can only capture what is visible, which is all the agent acts on anyway.
/// </summary>
internal static class ScreenGrabber
{
    private const int SmCxScreen = 0;
    private const int SmCyScreen = 1;

    public static CaptureDto Capture(string target)
    {
        ForegroundWindowDto foreground = WindowProbe.Foreground();
        Rectangle region = target switch
        {
            "primary-display" => PrimaryDisplay(),
            "foreground-window" => ForegroundRegion(),
            _ => throw new SidecarCommandException("unknown-target", $"unknown capture target '{target}'"),
        };

        if (region.Width <= 0 || region.Height <= 0)
        {
            throw new SidecarCommandException("empty-region", "the capture region has no area");
        }

        using Bitmap bitmap = new(region.Width, region.Height, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.CopyFromScreen(region.Left, region.Top, 0, 0, region.Size, CopyPixelOperation.SourceCopy);
        }

        using MemoryStream buffer = new();
        // PNG, not JPEG: screen text does not survive lossy compression, and OCR reads it.
        bitmap.Save(buffer, ImageFormat.Png);

        return new CaptureDto(
            ImageBase64: Convert.ToBase64String(buffer.ToArray()),
            Width: bitmap.Width,
            Height: bitmap.Height,
            DisplayScale: DisplayScale(),
            Foreground: foreground);
    }

    private static Rectangle PrimaryDisplay() =>
        new(0, 0, NativeMethods.GetSystemMetrics(SmCxScreen), NativeMethods.GetSystemMetrics(SmCyScreen));

    private static Rectangle ForegroundRegion()
    {
        IntPtr window = NativeMethods.GetForegroundWindow();
        NativeMethods.Rect frame = WindowProbe.FrameBounds(window);
        return Rectangle.Intersect(
            new Rectangle(frame.Left, frame.Top, frame.Width, frame.Height),
            PrimaryDisplay());
    }

    /// <summary>
    /// Captured pixels per logical point.
    ///
    /// The process is per-monitor DPI aware, so captures, window rectangles and
    /// UI Automation bounds are all in the same physical pixels and need no
    /// conversion between them. This value is reported for display purposes only.
    /// </summary>
    private static double DisplayScale()
    {
        uint dpi = NativeMethods.GetDpiForWindow(NativeMethods.GetForegroundWindow());
        return dpi == 0 ? 1.0 : dpi / 96.0;
    }
}
