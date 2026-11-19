namespace OpenApiVisualizer.Models;

/// <summary>
/// Optional vendor-extension mapping for the endpoint details panel. Many specs carry per-operation
/// authorization data in a custom <c>x-*</c> extension; point this at it to show it as "Permissions".
/// </summary>
public sealed class EndpointDetailsOptions
{
    public const string SectionName = "EndpointDetails";

    /// <summary>Operation-level extension name, e.g. <c>x-acme-authorize</c>. Unset disables the panel section.</summary>
    public string? PermissionsExtension { get; set; }

    /// <summary>String-array property inside the extension object; unset when the extension itself is the array.</summary>
    public string? PermissionsProperty { get; set; }
}
