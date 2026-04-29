const notesList = document.getElementById("notesList");
const titleInput = document.getElementById("title");
const editor = document.getElementById("editor");
const searchInput = document.getElementById("search");
const formatBlock = document.getElementById("formatBlock");

let notes = [];
let activeId = null;
let searchQuery = "";

// load
browser.storage.local.get("notes").then(res => {
  notes = res.notes || [];
  renderList();
});

// render listy + wyszukiwanie
function renderList() {
  notesList.innerHTML = "";

  const filtered = notes.filter(note => {
    const q = searchQuery.toLowerCase();

    const textContent = (note.content || "")
      .replace(/<[^>]+>/g, "")
      .toLowerCase();

    return (
      (note.title || "").toLowerCase().includes(q) ||
      textContent.includes(q)
    );
  });

  // 📭 brak notatek
  if (filtered.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "lista jest pusta, dodaj notatke";
    empty.style.padding = "10px";
    empty.style.color = "#777";

    notesList.appendChild(empty);
    return;
  }

  filtered.forEach(note => {
    const div = document.createElement("div");
    div.className = "note-item";

    const title = document.createElement("span");
    title.textContent = note.title || "Bez tytułu";
    title.style.cursor = "pointer";

    title.onclick = () => selectNote(note.id);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";
    delBtn.style.float = "right";
    delBtn.style.marginLeft = "5px";

    delBtn.onclick = (e) => {
      e.stopPropagation();

      notes = notes.filter(n => n.id !== note.id);

      if (activeId === note.id) {
        activeId = null;
        titleInput.value = "";
        editor.innerHTML = "";
      }

      saveAll();
      renderList();
    };

    div.appendChild(title);
    div.appendChild(delBtn);

    notesList.appendChild(div);
  });
}

// wybór
function selectNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  activeId = id;
  titleInput.value = note.title;
  editor.innerHTML = note.content || "";
}

// nowa
document.getElementById("new-note").onclick = () => {
  const newNote = {
    id: Date.now().toString(),
    title: "",
    content: "",
    created: Date.now()
  };

  notes.unshift(newNote);
  activeId = newNote.id;

  saveAll();
  renderList();
  selectNote(activeId);
};

// zapis
document.getElementById("save").onclick = () => {
  if (!activeId) return;

  const note = notes.find(n => n.id === activeId);
  if (!note) return;

  note.title = titleInput.value;
  note.content = editor.innerHTML;

  saveAll();
  renderList();
};

// delete
document.getElementById("delete").onclick = () => {
  if (!activeId) return;

  notes = notes.filter(n => n.id !== activeId);
  activeId = null;

  titleInput.value = "";
  editor.innerHTML = "";

  saveAll();
  renderList();
};

// toolbar (bold/italic/underline/listy)
document.querySelectorAll("#toolbar button").forEach(btn => {
  btn.onclick = () => {
    document.execCommand(btn.dataset.cmd, false, null);
    editor.focus();
  };
});

// nagłówki
formatBlock.onchange = () => {
  document.execCommand("formatBlock", false, formatBlock.value);
  editor.focus();
};

// wyszukiwarka
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderList();
});

// TAB / SHIFT+TAB / BACKSPACE
editor.addEventListener("keydown", (e) => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  let node = sel.anchorNode;

  while (node && node.nodeName !== "LI") {
    node = node.parentNode;
  }

  if (e.key === "Tab" && !e.shiftKey) {
    e.preventDefault();
    if (node) document.execCommand("indent");
  }

  if (e.key === "Tab" && e.shiftKey) {
    e.preventDefault();
    if (node) document.execCommand("outdent");
  }

  if (e.key === "Backspace") {
    if (node && node.textContent.trim() === "") {
      e.preventDefault();
      document.execCommand("outdent");
    }
  }
});

// save
function saveAll() {
  browser.storage.local.set({ notes });
}