import Foundation
import CoreText
import CoreGraphics
import CryptoKit

// Only completed exports use these APIs. The live library/key are never passed here.
enum ArchiveError: Error { case invalidPath, notUploaded, checksum, pdf }
func archiveURL(_ value: Any?, under folder: URL) throws -> URL {
    guard let path = value as? String, path.hasPrefix("/"), path.utf8.count < 8192 else { throw ArchiveError.invalidPath }
    let url = URL(fileURLWithPath: path).standardizedFileURL
    let root = folder.standardizedFileURL.resolvingSymlinksInPath()
    let actual = url.resolvingSymlinksInPath()
    guard actual.path.hasPrefix(root.path + "/"), actual.path == url.path,
          (try? url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) != true else { throw ArchiveError.invalidPath }
    return url
}
func archiveFiles(_ request: [String: Any]) throws -> (URL, [[String: Any]]) {
    guard let folder = request["folder"] as? String, folder.hasPrefix("/"),
          let files = request["files"] as? [[String: Any]], !files.isEmpty, files.count <= 12 else { throw ArchiveError.invalidPath }
    let root = URL(fileURLWithPath: folder).standardizedFileURL
    for file in files { _ = try archiveURL(file["path"], under: root) }
    return (root, files)
}
func iCloudStatus(_ url: URL) throws -> [String: Any] {
    let v = try url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemIsUploadedKey,
        .ubiquitousItemIsUploadingKey, .ubiquitousItemHasUnresolvedConflictsKey,
        .ubiquitousItemUploadingErrorKey, .ubiquitousItemDownloadingStatusKey,
        .fileSizeKey, .totalFileAllocatedSizeKey])
    let uploadError = v.ubiquitousItemUploadingError as NSError?
    return ["ubiquitous": v.isUbiquitousItem == true, "uploaded": v.ubiquitousItemIsUploaded == true,
        "uploading": v.ubiquitousItemIsUploading == true, "conflicts": v.ubiquitousItemHasUnresolvedConflicts == true,
        "uploadError": uploadError != nil, "uploadErrorCode": uploadError?.code ?? 0,
        "uploadErrorDomain": uploadError?.domain ?? "",
        "downloadStatus": v.ubiquitousItemDownloadingStatus?.rawValue ?? "unknown",
        "bytes": v.fileSize ?? -1, "allocatedBytes": v.totalFileAllocatedSize ?? -1]
}
func confirmedICloudUpload(_ status: [String: Any]) -> Bool {
    status["ubiquitous"] as? Bool == true && status["uploaded"] as? Bool == true &&
        status["uploading"] as? Bool == false && status["conflicts"] as? Bool == false && status["uploadError"] as? Bool == false
}
func archiveSHA256(_ url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url); defer { try? handle.close() }
    var hash = SHA256()
    while true { let data = try handle.read(upToCount: 1_048_576) ?? Data(); if data.isEmpty { break }; hash.update(data: data) }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
}
func archivePDF(_ request: [String: Any]) throws -> [String: Any] {
    guard let directory = request["folder"] as? String else { throw ArchiveError.invalidPath }
    let root = URL(fileURLWithPath: directory), input = try archiveURL(request["input"], under: root), output = try archiveURL(request["output"], under: root)
    guard input.lastPathComponent == "transcript-and-notes.txt", output.lastPathComponent == "transcript-and-notes.pdf",
          !FileManager.default.fileExists(atPath: output.path) else { throw ArchiveError.invalidPath }
    let text = try String(contentsOf: input, encoding: .utf8)
    guard text.utf8.count <= 10_000_000 else { throw ArchiveError.pdf }
    var box = CGRect(x: 0, y: 0, width: 612, height: 792)
    guard let context = CGContext(output as CFURL, mediaBox: &box, nil) else { throw ArchiveError.pdf }
    let font = CTFontCreateWithName("Helvetica" as CFString, 11, nil)
    let body = NSAttributedString(string: text, attributes: [NSAttributedString.Key(kCTFontAttributeName as String): font])
    let framesetter = CTFramesetterCreateWithAttributedString(body)
    var offset = 0, pages = 0
    while offset < body.length {
        context.beginPDFPage(nil)
        let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: offset, length: 0), CGPath(rect: CGRect(x: 48,y: 48,width: 516,height: 696), transform: nil), nil)
        let visible = CTFrameGetVisibleStringRange(frame)
        guard visible.length > 0, pages < 5000 else { context.endPDFPage(); context.closePDF(); throw ArchiveError.pdf }
        CTFrameDraw(frame, context); context.endPDFPage(); offset += visible.length; pages += 1
    }
    if pages == 0 { context.beginPDFPage(nil); context.endPDFPage(); pages = 1 }
    context.closePDF()
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: output.path)
    return ["saved": true, "pages": pages]
}
func archiveVerifyAndEvict(_ request: [String: Any]) throws -> [String: Any] {
    let (root, files) = try archiveFiles(request)
    for file in files {
        let url = try archiveURL(file["path"], under: root)
        let status = try iCloudStatus(url)
        guard confirmedICloudUpload(status), let size = file["bytes"] as? Int, size == status["bytes"] as? Int,
              let hash = file["sha256"] as? String, try archiveSHA256(url) == hash else { throw ArchiveError.checksum }
    }
    // Check again after hashing. An edited/conflicted/uploading file is never offloaded.
    for file in files { guard confirmedICloudUpload(try iCloudStatus(archiveURL(file["path"], under: root))) else { throw ArchiveError.notUploaded } }
    var audioEvicted = true
    for file in files where file["audio"] as? Bool == true {
        let url = try archiveURL(file["path"], under: root)
        try FileManager.default.evictUbiquitousItem(at: url)
        let status = try iCloudStatus(url)
        audioEvicted = audioEvicted && (status["downloadStatus"] as? String == URLUbiquitousItemDownloadingStatus.notDownloaded.rawValue)
    }
    return ["verified": true, "audioEvicted": audioEvicted]
}
func archiveCancelPending(_ request: [String: Any]) throws -> [String: Any] {
    let (root, files) = try archiveFiles(request)
    let manifest = try archiveURL(root.appendingPathComponent("manifest.json").path, under: root)
    guard let expected = request["manifestSHA256"] as? String, try archiveSHA256(manifest) == expected,
          let parsed = try JSONSerialization.jsonObject(with: Data(contentsOf: manifest)) as? [String: Any],
          let id = request["meetingId"] as? String, parsed["meetingId"] as? String == id,
          root.lastPathComponent.hasSuffix("-" + id) else { throw ArchiveError.invalidPath }
    let allUploaded = try files.allSatisfy { confirmedICloudUpload(try iCloudStatus(archiveURL($0["path"], under: root))) }
    if allUploaded { return ["alreadyUploaded": true, "trashed": false] }
    let expectedNames = Set(files.compactMap { ($0["path"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent } })
    let actual = Set(try FileManager.default.contentsOfDirectory(atPath: root.path).filter { $0 != ".DS_Store" })
    guard actual == expectedNames else { throw ArchiveError.invalidPath }
    // Cancelling an unpublished/pending export is recoverable through the normal Trash.
    // Already-synced archives are previous exports and are left in the user's iCloud.
    var resulting: NSURL?
    try FileManager.default.trashItem(at: root, resultingItemURL: &resulting)
    return ["alreadyUploaded": false, "trashed": true]
}

final class ArchiveFilePresenter: NSObject, NSFilePresenter {
    let presentedItemURL: URL?
    let presentedItemOperationQueue = OperationQueue.main
    var onChange: () -> Void
    var observedPresentedItemUbiquityAttributes: Set<URLResourceKey> {
        [.ubiquitousItemIsUploadedKey, .ubiquitousItemIsUploadingKey, .ubiquitousItemUploadingErrorKey, .ubiquitousItemHasUnresolvedConflictsKey]
    }
    init(url: URL, onChange: @escaping () -> Void) { presentedItemURL = url; self.onChange = onChange }
    func presentedItemDidChange() { onChange() }
    func presentedItemDidChangeUbiquityAttributes(_ attributes: Set<URLResourceKey>) { onChange() }
}

// One native child per pending export, driven by iCloud metadata notifications.
// It is owned/killed by Callwise. No daemon, scheduled AI task, or polling loop.
func runArchiveFiles() {
    guard let line = readLine(), line.utf8.count <= 1_048_576,
          let data = line.data(using: .utf8), let r = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let id = r["id"] as? String else { return }
    do {
        switch r["op"] as? String {
        case "pdf": answer(id, try archivePDF(r)); return
        case "status":
            let (root, files) = try archiveFiles(r)
            answer(id, ["files": try files.map { try iCloudStatus(archiveURL($0["path"], under: root)) }]); return
        case "verify-and-evict": answer(id, try archiveVerifyAndEvict(r)); return
        case "cancel-pending": answer(id, try archiveCancelPending(r)); return
        case "wait-upload": break
        default: throw ArchiveError.invalidPath
        }
        let (folder, files) = try archiveFiles(r), urls = try files.map { try archiveURL($0["path"], under: folder) }
        var done = false
        let evaluate = {
            guard !done else { return }
            let statuses = urls.map { (try? iCloudStatus($0)) ?? ["uploaded": false] }
            let count = statuses.filter(confirmedICloudUpload).count
            let errors = statuses.filter { $0["uploadError"] as? Bool == true }.map { ["code": $0["uploadErrorCode"] ?? 0, "domain": $0["uploadErrorDomain"] ?? ""] }
            emit(["type": "progress", "phase": "icloud-upload", "uploaded": count, "total": urls.count, "uploadErrors": errors ])
            if count == urls.count { done = true; answer(id, ["uploaded": true]) }
        }
        let presenters = urls.map { ArchiveFilePresenter(url: $0, onChange: evaluate) }
        for presenter in presenters { NSFileCoordinator.addFilePresenter(presenter) }
        // Some provider versions omit upload-attribute presenter notifications. This
        // bounded, per-export fallback reads metadata only; it never uploads or uses AI.
        let delays: [TimeInterval] = [2, 5, 15, 30, 60]
        var attempt = 0, fallback: Timer?
        func scheduleMetadataCheck() {
            fallback = Timer.scheduledTimer(withTimeInterval: delays[min(attempt, delays.count-1)], repeats: false) { _ in
                evaluate(); attempt += 1
                if !done { scheduleMetadataCheck() }
            }
        }
        scheduleMetadataCheck()
        let timeout = Timer.scheduledTimer(withTimeInterval: 23*60*60, repeats: false) { _ in
            if !done { done = true; answer(id, ["uploaded": false, "timedOut": true]) }
        }
        defer { timeout.invalidate(); fallback?.invalidate(); for presenter in presenters { NSFileCoordinator.removeFilePresenter(presenter) } }
        evaluate()
        while !done { _ = RunLoop.current.run(mode: .default, before: .distantFuture) }
    } catch { emit(["type": "error", "id": id, "code": "icloud_archive_unavailable"]) }
}
