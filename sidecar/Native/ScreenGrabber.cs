using System.IO;
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
    public static CaptureDto Capture(string target)
    {
        ForegroundWindowDto foreground = WindowProbe.Foreground();
        Rectangle region = target switch
        {
            "primary-display" => PrimaryDisplay(),
            "virtual-screen" => VirtualScreen(),
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
            // Where this image sits on the desktop. Image pixel (0,0) is this
            // screen coordinate, which is negative for a monitor placed above
            // or left of the primary one. Without it nothing can turn a pixel
            // found by OCR back into somewhere the mouse can be sent.
            OriginX: region.Left,
            OriginY: region.Top,
            DisplayScale: DisplayScale(),
            Foreground: foreground);
    }

    private static Rectangle PrimaryDisplay() => ToRectangle(NativeMethods.PrimaryScreen());

    /// <summary>Every monitor as one rectangle. Its origin is negative when a display sits above or left of the primary.</summary>
    private static Rectangle VirtualScreen() => ToRectangle(NativeMethods.VirtualScreen());

    private static Rectangle ForegroundRegion()
    {
        IntPtr window = NativeMethods.GetForegroundWindow();
        NativeMethods.Rect frame = WindowProbe.FrameBounds(window);

        // Clamped to the virtual screen, not the primary display: a window on a
        // secondary monitor lies wholly outside the primary rectangle, and
        // intersecting with it would yield an empty capture.
        return Rectangle.Intersect(
            new Rectangle(frame.Left, frame.Top, frame.Width, frame.Height),
            VirtualScreen());
    }

    private static Rectangle ToRectangle(NativeMethods.Rect rect) =>
        new(rect.Left, rect.Top, rect.Width, rect.Height);

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
