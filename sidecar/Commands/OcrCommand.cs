using System.Text.Json;
using JevSidecar.Native;
using JevSidecar.Protocol;

namespace JevSidecar.Commands;

/// <summary>
/// Recognise text in a supplied image, optionally within one rectangle.
///
/// Takes the image rather than referring to a cached capture: it keeps the
/// command stateless and the OCR port on the TypeScript side honest about its
/// input. The base64 round trip costs a few milliseconds against OCR's few
/// hundred, so it is not worth a cache until measurement says otherwise.
/// </summary>
internal sealed class OcrCommand : ICommandHandler
{
    public string Name => "ocr";

    public object Execute(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            throw new SidecarCommandException("bad-params", "ocr requires an object of parameters");
        }

        if (!parameters.TryGetProperty("imageBase64", out JsonElement image) || image.ValueKind != JsonValueKind.String)
        {
            throw new SidecarCommandException("bad-params", "ocr requires 'imageBase64'");
        }

        byte[] bytes;
        try
        {
            bytes = Convert.FromBase64String(image.GetString() ?? string.Empty);
        }
        catch (FormatException error)
        {
            throw new SidecarCommandException("bad-image", $"imageBase64 is not valid base64: {error.Message}");
        }

        if (bytes.Length == 0)
        {
            throw new SidecarCommandException("bad-image", "imageBase64 decoded to zero bytes");
        }

        return TextRecognizer.Recognize(bytes, ReadRegion(parameters));
    }

    private static RectDto? ReadRegion(JsonElement parameters)
    {
        if (!parameters.TryGetProperty("region", out JsonElement region) || region.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new RectDto(
            Number(region, "x"),
            Number(region, "y"),
            Number(region, "width"),
            Number(region, "height"));
    }

    private static double Number(JsonElement source, string property) =>
        source.TryGetProperty(property, out JsonElement value) && value.ValueKind == JsonValueKind.Number
            ? value.GetDouble()
            : throw new SidecarCommandException("bad-params", $"region.{property} must be a number");
}
