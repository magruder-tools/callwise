// Fixed JXA program. User text enters only through parsed JSON arguments.
function run(argv) {
  ObjC.import('Foundation');
  var input = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var request = JSON.parse($.NSString.alloc.initWithDataEncoding(input, $.NSUTF8StringEncoding).js || '{}');
  var notes = Application('Notes');
  if (request.op === 'folders') return JSON.stringify(notes.folders().map(function (f) { return { id: f.id(), title: f.name() }; }));
  if (request.op !== 'export' || typeof request.folderId !== 'string' || typeof request.key !== 'string' || !/^[a-zA-Z0-9:_-]{1,200}$/.test(request.key)) throw new Error('Invalid export.');
  var folders = notes.folders.whose({ id: request.folderId })();
  if (folders.length !== 1) throw new Error('Choose a Notes folder.');
  var folder = folders[0], marker = '[callwise:' + request.key + ']';
  function esc(value) { return String(value || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var content = String(request.text || '').split('\n').map(function (line) {
    var heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) return '<h' + heading[1].length + '>' + esc(heading[2]) + '</h' + heading[1].length + '>';
    return '<div>' + esc(line).replace(/^[-*]\s+/, '• ').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>') + '</div>';
  }).join('');
  var html = '<h1>' + esc(request.title) + '</h1>' + content + '<div>' + marker + '</div>';
  var existing = folder.notes.whose({ body: { _contains: marker } })();
  if (existing.length) {
    if (request.update === true) existing[0].body = html;
    return JSON.stringify({ id: existing[0].id(), existing: true, updated: request.update === true });
  }
  var note = notes.Note({ name: String(request.title || 'Callwise meeting').slice(0, 200), body: html });
  folder.notes.push(note); return JSON.stringify({ id: note.id(), existing: false });
}
