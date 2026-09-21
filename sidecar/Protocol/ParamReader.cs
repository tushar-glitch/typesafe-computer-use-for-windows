using System.Text.Json;

namespace JevSidecar.Protocol;

/// <summary>
/// Typed access to a request parameter object.
///
/// The client is typed, but the wire is not: a mismatched sidecar, a hand-sent
/// line during debugging, or a protocol change all arrive here as arbitrary
/// JSON. Every read states what was expected and fails with a stable code
/// rather than throwing whatever System.Text.Json happens to throw.
/// </summary>
internal static class ParamReader
{
    public static string RequiredString(JsonElement parameters, string name)
    {
        JsonElement value = Require(parameters, name);
        return value.ValueKind == JsonValueKind.String
            ? value.GetString() ?? string.Empty
            : throw Bad($"{name} must be a string");
    }

    public static double RequiredNumber(JsonElement parameters, string name)
    {
        JsonElement value = Require(parameters, name);
        return value.ValueKind == JsonValueKind.Number
            ? value.GetDouble()
            : throw Bad($"{name} must be a number");
    }

    public static int OptionalInt(JsonElement parameters, string name, int fallback)
    {
        if (parameters.ValueKind != JsonValueKind.Object
            || !parameters.TryGetProperty(name, out JsonElement value)
            || value.ValueKind != JsonValueKind.Number)
        {
            return fallback;
        }

        return value.GetInt32();
    }

    private static JsonElement Require(JsonElement parameters, string name)
    {
        if (parameters.ValueKind != JsonValueKind.Object)
        {
            throw Bad("parameters must be an object");
        }

        return parameters.TryGetProperty(name, out JsonElement value) ? value : throw Bad($"{name} is required");
    }

    private static SidecarCommandException Bad(string message) => new("bad-params", message);
}
