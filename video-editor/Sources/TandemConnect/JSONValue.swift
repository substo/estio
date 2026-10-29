import Foundation

/// Any JSON value. Device requests and responses are checked field by
/// field like the Node companion's zod schemas, so they're read as JSON
/// first rather than decoded straight into structs.
public enum JSONValue: Equatable, Sendable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .number(let value):
            // Whole numbers go out as integers, as JavaScript writes them.
            if value.rounded() == value, abs(value) < 9e15 { try container.encode(Int64(value)) } else { try container.encode(value) }
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    public static func parse(_ data: Data) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: data)
    }

    public func data() throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(self)
    }

    /// Compact JSON text, for size checks like `JSON.stringify(x).length`.
    public var text: String { (try? data()).flatMap { String(data: $0, encoding: .utf8) } ?? "" }

    public subscript(key: String) -> JSONValue? {
        if case .object(let object) = self { return object[key] }
        return nil
    }

    public var string: String? { if case .string(let value) = self { return value }; return nil }
    public var bool: Bool? { if case .bool(let value) = self { return value }; return nil }
    public var number: Double? { if case .number(let value) = self { return value }; return nil }
    public var array: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    public var object: [String: JSONValue]? { if case .object(let value) = self { return value }; return nil }
    public var isNull: Bool { self == .null }

    /// A whole number that fits an Int, like `Number.isInteger`.
    public var integer: Int? {
        guard case .number(let value) = self, value.rounded() == value, abs(value) < 9e15 else { return nil }
        return Int(value)
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) { self = .object(Dictionary(elements, uniquingKeysWith: { $1 })) }
    public init(nilLiteral: ()) { self = .null }
}

/// Small checks shared by the device protocol, ported from the zod schemas
/// and `devices-policy.ts`.
enum Check {
    static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }

    /// zod's `uuid()`: any 8-4-4-4-12 hex string.
    static func isUUID(_ value: String?) -> Bool {
        guard let value else { return false }
        return matches(value, "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    }

    /// zod's `datetime({ offset: true })`: ISO 8601 with Z or an offset.
    static func date(_ value: String?) -> Date? {
        guard let value, matches(value, #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$"#) else { return nil }
        // The formatter reads up to milliseconds; Postgres writes microseconds.
        var text = value
        if let dot = text.firstIndex(of: "."), let end = text[dot...].firstIndex(where: { !$0.isNumber && $0 != "." }) {
            let digits = text[text.index(after: dot)..<end]
            text.replaceSubrange(text.index(after: dot)..<end, with: String((digits + "000").prefix(3)))
        }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = text.contains(".") ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter.date(from: text)
    }

    /// `Date.prototype.toISOString`.
    static func isoString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: date)
    }

    static let modelPattern = "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$"
    static func isModel(_ value: String?) -> Bool { value.map { matches($0, modelPattern) } ?? false }
}
