import XCTest
@testable import TandemApp
@testable import TandemCore

final class StyleLibraryTests: XCTestCase {
    func testEditorV1PromptIsScopedToSelectedClipsAndRequiresReview() throws {
        var project = Project.standard(name: "Style test")
        let camera = try XCTUnwrap(project.track(named: "Camera"))
        let clip = Clip(id: "clip_selected", content: .solid(color: RGBA(r: 0.1, g: 0.1, b: 0.1)), start: Time(seconds: 5), duration: Time(seconds: 3))
        let location = try XCTUnwrap(project.location(ofTrack: camera.id))
        project[location].clips.append(clip)

        let proposal = try XCTUnwrap(StyleProposal.editorV1(selection: [clip.id], project: project, projectFile: "/tmp/Style test.substo", revision: 7))
        XCTAssertEqual(proposal.range, clip.range)
        XCTAssertTrue(proposal.instructions.contains("clip_selected"))
        XCTAssertTrue(proposal.instructions.contains("/tmp/Style test.substo"))
        XCTAssertTrue(proposal.instructions.contains("expectedRevision: 7"))
        XCTAssertTrue(proposal.instructions.contains("dryRun: true"))
        XCTAssertTrue(proposal.instructions.contains("substo apply <batch.json> --dry-run --expect 7"))
        XCTAssertTrue(proposal.instructions.contains("only after I review"))
        XCTAssertNil(StyleProposal.editorV1(selection: [], project: project, projectFile: "/tmp/Style test.substo", revision: 7))
    }

    func testEditorV1BuildsValidatedNativeBatchOnlyForSelectedText() throws {
        var project = Project.standard(name: "Style batch")
        let textTrack = try XCTUnwrap(project.track(named: "Text"))
        let location = try XCTUnwrap(project.location(ofTrack: textTrack.id))
        let selected = Clip(id: "clip_caption", content: .text(TextContent(text: "hello", style: TextStyle(font: "Helvetica", size: 72))), start: Time(seconds: 5), duration: Time(seconds: 1))
        let untouched = Clip(id: "clip_other", content: .text(TextContent(text: "world")), start: Time(seconds: 7), duration: Time(seconds: 1))
        project[location].clips.append(contentsOf: [selected, untouched])

        let proposal = try XCTUnwrap(StyleProposal.editorV1(selection: [selected.id], project: project, projectFile: "/tmp/Style.substo", revision: 12))
        let batch = try XCTUnwrap(proposal.batch)
        XCTAssertEqual(batch.expectedRevision, 12)
        XCTAssertEqual(batch.commands.count, 1)
        XCTAssertTrue(proposal.validationMessage.contains("validated"))
        XCTAssertTrue(proposal.batchJSON.contains("clip_caption"))
        XCTAssertFalse(proposal.batchJSON.contains("clip_other"))
        XCTAssertEqual(try JSONDecoder().decode(EditBatch.self, from: Data(proposal.batchJSON.utf8)), batch)
        XCTAssertEqual(project.clip(selected.id), selected, "preparing a proposal does not edit the timeline")

        var preview = project
        var context = EditContext()
        try Editing.apply(batch.commands[0], to: &preview, context: &context)
        guard case .text(let styled) = try XCTUnwrap(preview.clip(selected.id)).content else { return XCTFail("text clip expected") }
        XCTAssertEqual(styled.style.font, "Helvetica", "the creator's font survives")
        XCTAssertEqual(styled.style.size, 72, "the creator's size survives")
        XCTAssertEqual(styled.style.alignment, "center")
        XCTAssertEqual(styled.style.weight, 800)
        XCTAssertEqual(preview.clip(untouched.id), untouched)
    }

    func testAlreadyStyledTextNeedsNoBatch() throws {
        var project = Project.standard(name: "Styled")
        let track = try XCTUnwrap(project.track(named: "Text"))
        let location = try XCTUnwrap(project.location(ofTrack: track.id))
        let clip = Clip(id: "clip_done", content: .text(TextContent(text: "done", style: TextStyle(weight: 800, alignment: "center"))), start: .zero, duration: Time(seconds: 1))
        project[location].clips.append(clip)
        let proposal = try XCTUnwrap(StyleProposal.editorV1(selection: [clip.id], project: project, projectFile: "/tmp/Styled.substo", revision: 3))
        XCTAssertNil(proposal.batch)
        XCTAssertTrue(proposal.batchJSON.isEmpty)
        XCTAssertTrue(proposal.validationMessage.contains("Already styled"))
    }
}
