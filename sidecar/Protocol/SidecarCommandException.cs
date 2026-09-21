namespace JevSidecar.Protocol;

/// <summary>
/// A failure the caller is expected to handle, carrying a stable code.
///
/// Anything else escaping a command is a bug and is reported as "internal".
/// </summary>
internal sealed class SidecarCommandException : Exception
{
    public SidecarCommandException(string code, string message)
        : base(message)
    {
        Code = code;
    }

    public string Code { get; }
}
