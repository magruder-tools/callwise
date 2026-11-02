import Foundation
import AVFoundation
import CoreML
import FluidAudio

func modelsDirectory() -> URL { URL(fileURLWithPath: ProcessInfo.processInfo.environment["CALLWISE_NATIVE_RESOURCES"] ?? "").appendingPathComponent("models") }
func diarizationAvailable() -> Bool {
    let root = modelsDirectory()
    return ["Segmentation.mlmodelc", "FBank.mlmodelc", "Embedding.mlmodelc", "PldaRho.mlmodelc", "plda-parameters.json"].allSatisfy { FileManager.default.fileExists(atPath: root.appendingPathComponent($0).path) }
}
actor GroupDiarizer {
    var audio = [Float]()
    var manager: OfflineDiarizerManager?
    var converter: AVAudioConverter?
    let inputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 24000, channels: 1, interleaved: false)!
    let outputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    func start() throws {
        guard diarizationAvailable() else { throw NativeFailure.unavailable }
        audio.removeAll(keepingCapacity: false); converter = AVAudioConverter(from: inputFormat, to: outputFormat); converter?.primeMethod = .none
    }
    func append(_ data: Data, at ms: Double) throws {
        guard data.count % 2 == 0, data.count <= 480000, audio.count < 16000 * 7200 else { return }
        let count = data.count / 2; guard count > 0, let input = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(count)), let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(ceil(Double(count) * 2 / 3) + 32)) else { throw NativeFailure.format }
        input.frameLength = AVAudioFrameCount(count)
        data.withUnsafeBytes { raw in for i in 0..<count { input.floatChannelData![0][i] = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: i * 2, as: Int16.self))) / 32768 } }
        var supplied = false, error: NSError?
        converter?.convert(to: output, error: &error) { _, status in if supplied { status.pointee = .noDataNow; return nil }; supplied = true; status.pointee = .haveData; return input }
        if error != nil { throw NativeFailure.format }
        let target = max(0, Int(ms * 16)), gap = target - audio.count
        if gap > 1600 && gap < 16000 * 7200 - audio.count { audio.append(contentsOf: repeatElement(0, count: gap)) }
        let length = min(Int(output.frameLength), 16000 * 7200 - audio.count)
        if length > 0 { audio.append(contentsOf: UnsafeBufferPointer(start: output.floatChannelData![0], count: length)) }
    }
    func load() throws {
        if manager != nil { return }; guard diarizationAvailable() else { throw NativeFailure.unavailable }
        let root = modelsDirectory()
        func model(_ name: String, cpu: Bool = false) throws -> MLModel { let c = MLModelConfiguration(); c.computeUnits = cpu ? .cpuOnly : .all; return try MLModel(contentsOf: root.appendingPathComponent(name), configuration: c) }
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("plda-parameters.json"))) as? [String: Any]
        guard let tensors = json?["tensors"] as? [String: Any], let psi = tensors["psi"] as? [String: Any], let encoded = psi["data_base64"] as? String, let raw = Data(base64Encoded: encoded), raw.count % 4 == 0 else { throw NativeFailure.invalid }
        let values = raw.withUnsafeBytes { data in (0..<(raw.count / 4)).map { Double(Float(bitPattern: UInt32(littleEndian: data.loadUnaligned(fromByteOffset: $0 * 4, as: UInt32.self)))) } }
        // Direct MLModel construction bypasses every SDK network/cache fallback.
        let models = try OfflineDiarizerModels(segmentationModel: model("Segmentation.mlmodelc"), fbankModel: model("FBank.mlmodelc", cpu: true), embeddingModel: model("Embedding.mlmodelc"), pldaRhoModel: model("PldaRho.mlmodelc"), pldaPsi: values, compilationDuration: 0)
        let diarizer = OfflineDiarizerManager(config: .default); diarizer.initialize(models: models); manager = diarizer
    }
    func run(final: Bool) async throws -> [[String: Any]] {
        guard audio.count >= 16000 else { return [] }; try load()
        let result = try await manager!.process(audio: audio)
        let turns = result.segments.map { ["cluster": $0.speakerId, "startMs": Double($0.startTimeSeconds) * 1000, "endMs": Double($0.endTimeSeconds) * 1000] as [String: Any] }
        if final { audio.removeAll(keepingCapacity: false) }; return turns
    }
    func cancel() { audio.removeAll(keepingCapacity: false); manager = nil; converter = nil }
}
let groupDiarizer = GroupDiarizer()
func diarize(_ request: [String: Any]) async throws -> Any {
    switch request["op"] as? String {
    case "start": try await groupDiarizer.start(); return ["ready": true]
    case "push": guard let data = Data(base64Encoded: request["audio"] as? String ?? "") else { throw NativeFailure.invalid }; try await groupDiarizer.append(data, at: request["startMs"] as? Double ?? 0); return ["accepted": true]
    case "refresh": return ["turns": try await groupDiarizer.run(final: false), "final": false]
    case "finish": return ["turns": try await groupDiarizer.run(final: true), "final": true]
    case "close": await groupDiarizer.cancel(); return ["closed": true]
    default: throw NativeFailure.invalid
    }
}
