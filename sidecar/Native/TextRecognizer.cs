using JevSidecar.Protocol;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace JevSidecar.Native;

/// <summary>
/// Text off the screen, via the OCR engine built into Windows.
///
/// Chosen over Tesseract deliberately: it ships with the OS, costs nothing,
/// needs no model files, and is tuned for exactly this input — crisp, printed,
/// anti-aliased UI text rather than photographs of documents.
///
/// One consequence to know about: Windows OCR reports no per-word confidence.
/// Every line therefore comes back at 1.0, and callers must not build
/// confidence filtering on OCR the way an engine like Tesseract would allow.
/// </summary>
internal static class TextRecognizer
{
    /// <summary>Built once: engine construction loads language data and is not cheap.</summary>
    private static readonly Lazy<OcrEngine> Engine = new(CreateEngine);

    /// <summary>
    /// Force engine construction before the first real request.
    ///
    /// Building the engine loads language data and costs roughly 450ms. Paid
    /// lazily it lands on the user first command, which is the one moment the
    /// system must feel immediate.
    /// </summary>
    public static void Warmup() => _ = Engine.Value;

    public static OcrResultDto Recognize(byte[] imageBytes, RectDto? region)
    {
        // The host loop is serial, so blocking here costs nothing that a state
        // machine would save, and keeps ICommandHandler synchronous.
        return RecognizeAsync(imageBytes, region).GetAwaiter().GetResult();
    }

    private static async Task<OcrResultDto> RecognizeAsync(byte[] imageBytes, RectDto? region)
    {
        using InMemoryRandomAccessStream stream = new();
        using (DataWriter writer = new(stream))
        {
            writer.WriteBytes(imageBytes);
            _ = await writer.StoreAsync();
            _ = await writer.FlushAsync();
            _ = writer.DetachStream();
        }

        stream.Seek(0);
        BitmapDecoder decoder = await BitmapDecoder.CreateAsync(stream);

        // Crop inside the decoder rather than after: the pixels outside the
        // region are never decoded, and OCR cost scales with what it is given.
        (BitmapTransform transform, double offsetX, double offsetY) = BuildTransform(decoder, region);

        using SoftwareBitmap bitmap = await decoder.GetSoftwareBitmapAsync(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Premultiplied,
            transform,
            ExifOrientationMode.IgnoreExifOrientation,
            ColorManagementMode.DoNotColorManage);

        if (bitmap.PixelWidth > OcrEngine.MaxImageDimension || bitmap.PixelHeight > OcrEngine.MaxImageDimension)
        {
            throw new SidecarCommandException(
                "image-too-large",
                $"image is {bitmap.PixelWidth}x{bitmap.PixelHeight}; the engine accepts up to {OcrEngine.MaxImageDimension}px per side");
        }

        OcrResult result = await Engine.Value.RecognizeAsync(bitmap);

        List<OcrLineDto> lines = [];
        foreach (OcrLine line in result.Lines)
        {
            RectDto? bounds = UnionOfWords(line, offsetX, offsetY);
            if (bounds is null || line.Text.Length == 0)
            {
                continue;
            }

            // Windows OCR exposes no confidence; see the class remarks.
            lines.Add(new OcrLineDto(line.Text, 1.0, bounds));
        }

        return new OcrResultDto(lines, Engine.Value.RecognizerLanguage.LanguageTag);
    }

    private static (BitmapTransform Transform, double OffsetX, double OffsetY) BuildTransform(
        BitmapDecoder decoder,
        RectDto? region)
    {
        if (region is null)
        {
            return (new BitmapTransform(), 0, 0);
        }

        // Clamp to the image: a region from a stale capture can hang off the edge.
        uint x = (uint)Math.Clamp(region.X, 0, decoder.PixelWidth);
        uint y = (uint)Math.Clamp(region.Y, 0, decoder.PixelHeight);
        uint width = (uint)Math.Clamp(region.Width, 0, decoder.PixelWidth - x);
        uint height = (uint)Math.Clamp(region.Height, 0, decoder.PixelHeight - y);

        if (width == 0 || height == 0)
        {
            throw new SidecarCommandException("empty-region", "the requested OCR region has no area");
        }

        BitmapTransform transform = new() { Bounds = new BitmapBounds { X = x, Y = y, Width = width, Height = height } };
        return (transform, x, y);
    }

    /// <summary>
    /// A line's box, as the union of its words.
    ///
    /// OcrLine carries no rectangle of its own, only the words do.
    /// </summary>
    private static RectDto? UnionOfWords(OcrLine line, double offsetX, double offsetY)
    {
        double left = double.MaxValue;
        double top = double.MaxValue;
        double right = double.MinValue;
        double bottom = double.MinValue;
        bool any = false;

        foreach (OcrWord word in line.Words)
        {
            left = Math.Min(left, word.BoundingRect.Left);
            top = Math.Min(top, word.BoundingRect.Top);
            right = Math.Max(right, word.BoundingRect.Right);
            bottom = Math.Max(bottom, word.BoundingRect.Bottom);
            any = true;
        }

        if (!any || right <= left || bottom <= top)
        {
            return null;
        }

        // Back into full-image coordinates, so nothing downstream knows a crop happened.
        return new RectDto(left + offsetX, top + offsetY, right - left, bottom - top);
    }

    private static OcrEngine CreateEngine()
    {
        OcrEngine? engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine is not null)
        {
            return engine;
        }

        // The user's display languages carry no OCR data; fall back to English.
        Language english = new("en-US");
        engine = OcrEngine.IsLanguageSupported(english) ? OcrEngine.TryCreateFromLanguage(english) : null;

        return engine ?? throw new SidecarCommandException(
            "no-ocr-language",
            "Windows has no OCR language pack installed. Add one under Settings > Time & Language > Language.");
    }
}
