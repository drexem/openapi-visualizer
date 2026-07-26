namespace OpenApiVisualizer.Models;

public sealed class SpecSummary
{
    public required string SpecId { get; init; }
    public required string Title { get; init; }
    public required string Version { get; init; }
    public required int EndpointCount { get; init; }
    public required int SchemaCount { get; init; }
    public required int CycleCount { get; init; }
    public required DateTimeOffset ImportedAt { get; init; }
}

public sealed class EndpointInfo
{
    public required string Id { get; init; }
    public required string Method { get; init; }
    public required string Path { get; init; }
    public string? Summary { get; init; }
    public string? OperationId { get; init; }
    public IReadOnlyList<string> Tags { get; init; } = [];
    public IReadOnlyList<EndpointSchemaUse> SchemaUses { get; init; } = [];
    public string? DiffState { get; init; }
    public IReadOnlyList<DiffEntry> DiffEntries { get; init; } = [];
}

public sealed class EndpointSchemaUse
{
    public required string SchemaId { get; init; }
    public required string Kind { get; init; }
    public required string Label { get; init; }
}

public sealed class SchemaInfo
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string? Type { get; init; }
    public string? Format { get; init; }
    public string? Description { get; init; }
    public IReadOnlyList<SchemaPropertyInfo> Properties { get; init; } = [];
    public IReadOnlyList<string> EnumValues { get; init; } = [];
    public int OutgoingReferenceCount { get; init; }
    public int IncomingReferenceCount { get; set; }
    public int? CycleId { get; set; }
    public string? DiffState { get; init; }
    public IReadOnlyList<DiffEntry> DiffEntries { get; init; } = [];
}

public sealed class SchemaPropertyInfo
{
    public required string Name { get; init; }
    public string? Type { get; init; }
    public string? Format { get; init; }
    public string? SourceSchemaId { get; init; }
    public string? SourceSchemaName { get; init; }
    public bool Inherited { get; init; }
    public bool Required { get; init; }
    public bool Nullable { get; init; }
    public string? RefId { get; init; }
    public string? ItemsRefId { get; init; }
    public IReadOnlyList<string> EnumValues { get; init; } = [];
    public string? DiffState { get; init; }
    public string? PreviousType { get; init; }
}

public sealed class SchemaEdge
{
    public required string SourceSchemaId { get; init; }
    public required string TargetSchemaId { get; init; }
    public required string Kind { get; init; }
    public required string Label { get; init; }
}

public sealed class CycleInfo
{
    public required int Id { get; init; }
    public required IReadOnlyList<string> SchemaIds { get; init; }
}

public sealed class GraphRequest
{
    public IReadOnlyList<string> EndpointIds { get; init; } = [];
    public string? CompareSpecId { get; init; }
    public int Depth { get; init; } = 2;
    public int MaxNodes { get; init; } = 250;
    public bool IncludeProperties { get; init; } = true;
    public bool AllReachable { get; init; }
    public bool HideEnums { get; init; }
    public bool HideErrorResponses { get; init; }
}

public sealed class GraphResponse
{
    public required IReadOnlyList<GraphNode> Nodes { get; init; }
    public required IReadOnlyList<GraphEdge> Edges { get; init; }
    public required IReadOnlyList<CycleInfo> Cycles { get; init; }
    public IReadOnlyList<string> Warnings { get; init; } = [];
}

public sealed class GraphNode
{
    public required string Id { get; init; }
    public required string Kind { get; init; }
    public required string Label { get; init; }
    public string? Subtitle { get; init; }
    public string? Method { get; init; }
    public int? CycleId { get; init; }
    public IReadOnlyList<SchemaPropertyInfo> Properties { get; init; } = [];
    public IReadOnlyList<string> EnumValues { get; init; } = [];
    public IReadOnlyList<string> Tags { get; init; } = [];
    public string? DiffState { get; init; }
    public IReadOnlyList<DiffEntry> DiffEntries { get; init; } = [];
}

public sealed class GraphEdge
{
    public required string Id { get; init; }
    public required string Source { get; init; }
    public required string Target { get; init; }
    public required string Kind { get; init; }
    public required string Label { get; init; }
    public string? DiffState { get; init; }
}

public sealed class DiffEntry
{
    public required string State { get; init; }
    public required string Label { get; init; }
    public string? Before { get; init; }
    public string? After { get; init; }
}

public sealed class SpecDiffSummary
{
    public required string BaseSpecId { get; init; }
    public required string CompareSpecId { get; init; }
    public required SpecSummary CompareSummary { get; init; }
    public required DiffCounts Counts { get; init; }
    public required IReadOnlyList<EndpointInfo> ChangedEndpoints { get; init; }
}

public sealed class DiffCounts
{
    public required int AddedEndpoints { get; init; }
    public required int DeletedEndpoints { get; init; }
    public required int ModifiedEndpoints { get; init; }
    public required int AddedSchemas { get; init; }
    public required int DeletedSchemas { get; init; }
    public required int ModifiedSchemas { get; init; }
    public required int AddedEdges { get; init; }
    public required int DeletedEdges { get; init; }
}
