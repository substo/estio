import AppKit
import SwiftUI
import TandemCore

/// A style is a reference and a recipe, not a second project format.
struct VideoStyle: Identifiable {
    let id: String
    let name: String
    let source: String
    let summary: String
    let recipe: [String]
    let textStylePatch: JSONValue?

    static let editorV1 = VideoStyle(
        id: "editor-v1",
        name: "Editor V1",
        source: "Derived from the Editor V1 / Persa Shorts reference kit",
        summary: "Face-led vertical short with one-word captions, display words and real product screens.",
        recipe: [
            "Keep the creator's camera as the frame.",
            "Use one-word captions on one fixed line, timed to speech.",
            "Use display words sparingly; keep the face in front when a cutout exists.",
            "Let real product screens own the frame and place the creator in a camera card.",
            "Use the project's brand colours, fonts and licensed media."
        ],
        // The first native step changes only caption weight and alignment.
        // Font, size and colour remain the creator's choices.
        textStylePatch: .object(["alignment": .string("center"), "weight": .number(800)])
    )
}

/// An instruction for a scoped native edit. Preparing it never mutates the project.
struct StyleProposal {
    let projectFile: String
    let range: TimeRange
    let instructions: String
    let batch: EditBatch?
    let batchJSON: String
    let validationMessage: String
    let changeSummary: String

    @MainActor
    func canApply(to model: EditorModel) -> Bool {
        batch != nil && model.fileURL.path == projectFile && model.revision == batch?.expectedRevision
    }

    @MainActor
    @discardableResult
    func apply(to model: EditorModel) -> Bool {
        guard canApply(to: model) else { return false }
        return model.apply(batch) != nil
    }

    static func editorV1(selection: Set<String>, project: Project, projectFile: String, revision: Int) -> StyleProposal? {
        let clips = selection.compactMap(project.clip).sorted { $0.id < $1.id }
        guard let first = clips.first else { return nil }
        let range = TimeRange(start: clips.map(\.start).min() ?? first.start, end: clips.map(\.end).max() ?? first.end)
        let start = String(format: "%.3f", range.start.seconds)
        let end = String(format: "%.3f", range.end.seconds)
        let ids = clips.map(\.id).joined(separator: ", ")
        let style = VideoStyle.editorV1
        let steps = style.recipe.enumerated().map { "\($0.offset + 1). \($0.element)" }.joined(separator: "\n")
        let textClips = clips.filter {
            guard case .text(let content) = $0.content else { return false }
            return content.style.alignment != "center" || content.style.weight != 800
        }
        let changeSummary = textClips.compactMap { clip -> String? in
            guard case .text(let content) = clip.content else { return nil }
            let name = clip.name.flatMap { $0.isEmpty ? nil : $0 } ?? clip.id
            return "\(name) (\(clip.id)): alignment \(content.style.alignment ?? "inherited") → center, weight \(content.style.weight.map { String(format: "%.0f", $0) } ?? "inherited") → 800"
        }.joined(separator: "\n")
        let commands = textClips.compactMap { clip -> EditCommand? in
            guard let patch = style.textStylePatch else { return nil }
            return .updateClip(clipID: clip.id, patch: .object(["content": .object(["text": .object(["style": patch])])]))
        }
        let candidate = commands.isEmpty ? nil : EditBatch(label: "Editor V1 caption style", commands: commands, expectedRevision: revision)
        let validated: EditBatch?
        let validationMessage: String
        if let candidate {
            do {
                var preview = project
                var context = EditContext()
                for command in candidate.commands { try Editing.apply(command, to: &preview, context: &context) }
                if let issue = ProjectValidator.validate(preview).first(where: { $0.severity == .error }) {
                    validated = nil
                    validationMessage = "Could not validate this batch: \(issue.message)"
                } else {
                    validated = candidate
                    validationMessage = "\(commands.count) native edit command\(commands.count == 1 ? "" : "s") validated against a copy of this project. Nothing was applied."
                }
            } catch {
                validated = nil
                validationMessage = "Could not validate this batch: \(error)"
            }
        } else {
            validated = nil
            validationMessage = "Select text clips that need the Editor V1 caption style. Already styled clips need no edit."
        }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let batchJSON = validated.flatMap { try? encoder.encode($0) }.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        return StyleProposal(projectFile: projectFile, range: range, instructions: """
        Edit the existing .substo project at \(projectFile) using the general substo-video skill.
        Style reference: \(style.name) (\(style.id)); source: \(style.source).
        Scope: only selected clip IDs \(ids), within timeline seconds \(start)–\(end).
        Project revision: \(revision). Use expectedRevision: \(revision) for every proposed batch.

        Recipe for this range:
        \(steps)

        The first proposed native step, when selected text clips exist, changes their alignment and weight only. Inspect these clips and their transcript/media before proposing any further steps. Do not change clips outside this range, introduce unapproved third-party footage, or rebuild the project. Run substo apply <batch.json> --dry-run --expect \(revision) (dryRun: true via API) on the attached batch and show the result against the current timeline. Apply a batch only after I review and approve its listed changes. Do not render the full video.
        """, batch: validated, batchJSON: batchJSON, validationMessage: validationMessage, changeSummary: changeSummary)
    }
}

struct StylesLibrary: View {
    let model: EditorModel
    @State private var proposal: StyleProposal?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text("Styles")
                    .font(.ui(16, .bold))
                    .foregroundStyle(Theme.text.color)
                Text("Reference recipes for edits to your current timeline. Select clips before preparing instructions.")
                    .font(.ui(12))
                    .foregroundStyle(Theme.textMuted.color)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 9) {
                    Text(VideoStyle.editorV1.name).font(.ui(14, .bold))
                    Text(VideoStyle.editorV1.summary).font(.ui(12))
                    Text("Source: \(VideoStyle.editorV1.source)").font(.ui(10.5))
                    Text(scope).font(.ui(11, .semibold))
                    Button("Prepare edit proposal") {
                        proposal = StyleProposal.editorV1(selection: model.selection, project: model.project, projectFile: model.fileURL.path, revision: model.revision)
                    }
                    .disabled(model.selection.isEmpty)
                }
                .foregroundStyle(Theme.text.color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(RoundedRectangle(cornerRadius: 10).fill(Theme.tabSelected.color))
            }
            .padding(14)
        }
        .sheet(item: $proposal) { proposal in
            StyleProposalSheet(proposal: proposal, model: model)
        }
    }

    private var scope: String {
        let clips = model.selection.compactMap(model.project.clip)
        guard let start = clips.map(\.start).min(), let end = clips.map(\.end).max() else {
            return "Select timeline clips to set the edit range."
        }
        return String(format: "Scope: %d selected clips · %.2f–%.2f s", clips.count, start.seconds, end.seconds)
    }
}

private struct StyleProposalSheet: View {
    @Environment(\.dismiss) private var dismiss
    let proposal: StyleProposal
    let model: EditorModel
    @State private var applied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Editor V1 · edit proposal").font(.headline)
            Text(applied ? "Applied as one undoable edit." : "Review the changes before applying. The dry run changed no timeline clips.")
                .font(.subheadline)
            Text(proposal.validationMessage).font(.subheadline)
            if !proposal.changeSummary.isEmpty {
                Text(proposal.changeSummary)
                    .font(.system(size: 11, design: .monospaced))
                    .textSelection(.enabled)
            }
            if proposal.batch != nil && !proposal.canApply(to: model) && !applied {
                Text("The timeline changed since this proposal was prepared. Close this sheet and prepare it again.")
                    .font(.subheadline)
                    .foregroundStyle(.orange)
            }
            ScrollView {
                Text(proposal.batch == nil ? proposal.instructions : proposal.batchJSON + "\n\nNext steps\n" + proposal.instructions)
                    .font(.system(size: 12, design: .monospaced))
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            HStack {
                Spacer()
                Button("Close") { dismiss() }
                Button("Copy instructions") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(proposal.instructions, forType: .string)
                }
                if proposal.batch != nil {
                    Button("Copy edit batch") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(proposal.batchJSON, forType: .string)
                    }
                    Button("Apply listed changes") {
                        applied = proposal.apply(to: model)
                    }
                    .disabled(applied || !proposal.canApply(to: model))
                }
            }
        }
        .padding(20)
        .frame(width: 620, height: 480)
    }
}

extension StyleProposal: Identifiable {
    var id: String { instructions }
}
