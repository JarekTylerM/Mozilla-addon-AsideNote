const notesList = document.getElementById("notesList");
const titleInput = document.getElementById("title");
const editor = document.getElementById("editor");
const searchInput = document.getElementById("search");
const formatBlock = document.getElementById("formatBlock");

let notes = [];
let activeId = null;
let searchQuery = "";

/* ===================== HELPERS ===================== */

function debounce(fn, delay = 600) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function isNoteEmpty() {
  return (
    titleInput.value.trim() === "" &&
    editor.innerText.trim() === ""
  );
}

function updateDeleteState() {
  const deleteBtn = document.getElementById("delete");
  if (!deleteBtn) return;

  if (!activeId || isNoteEmpty()) {
    deleteBtn.disabled = true;
    deleteBtn.style.opacity = "0.5";
  } else {
    deleteBtn.disabled = false;
    deleteBtn.style.opacity = "1";
  }
}

function clearCurrentLine() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const node = sel.anchorNode;
  if (node && node.nodeType === 3) {
    node.textContent = "";
  }
}

function getCurrentLine() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return "";
  return sel.anchorNode.textContent || "";
}

/* ===================== STORAGE ===================== */

browser.storage.local.get("notes").then(res => {
  notes = res.notes || [];
  renderList();
});

/* ===================== RENDER ===================== */

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

  if (filtered.length === 0 && searchQuery === "") {
    const empty = document.createElement("div");
    empty.textContent = "Lista jest pusta, dodaj notatkę";
    empty.style.padding = "10px";
    empty.style.color = "#777";
    notesList.appendChild(empty);
    return;
  }

  filtered.sort((a, b) => b.created - a.created);

  filtered.forEach(note => {
    const div = document.createElement("div");
    div.className = "note-item";

    if (note.id === activeId) {
      div.classList.add("active-note");
    }

    const title = document.createElement("span");
    title.textContent = note.title || "Bez tytułu";
    title.onclick = () => selectNote(note.id);

    const delBtn = document.createElement("button");
    delBtn.textContent = "✕";

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

  updateDeleteState();
}

/* ===================== NOTE ===================== */

function selectNote(id) {
  const note = notes.find(n => n.id === id);
  if (!note) return;

  activeId = id;
  titleInput.value = note.title;
  editor.innerHTML = note.content || "";

  renderList();
  updateDeleteState();
}

document.getElementById("new-note").onclick = () => {
  activeId = null;
  titleInput.value = "";
  editor.innerHTML = "";
  updateDeleteState();
};

/* ===================== AUTOSAVE ===================== */

function saveActiveNote() {
  if (!activeId && isNoteEmpty()) return;

  if (!activeId) {
    const newNote = {
      id: Date.now().toString(),
      title: titleInput.value,
      content: editor.innerHTML,
      created: Date.now()
    };
    notes.unshift(newNote);
    activeId = newNote.id;
  } else {
    const note = notes.find(n => n.id === activeId);
    if (!note) return;

    note.title = titleInput.value;
    note.content = editor.innerHTML;
  }

  saveAll();
  renderList();
}

const debouncedSave = debounce(saveActiveNote, 600);

titleInput.addEventListener("input", debouncedSave);
editor.addEventListener("input", debouncedSave);

/* ===================== DELETE ===================== */

document.getElementById("delete").onclick = () => {
  if (!activeId) return;

  notes = notes.filter(n => n.id !== activeId);
  activeId = null;

  titleInput.value = "";
  editor.innerHTML = "";

  saveAll();
  renderList();
};

/* ===================== TOOLBAR ===================== */

document.querySelectorAll("#toolbar button").forEach(btn => {
  if (btn.id === "code-btn") return;

  btn.onclick = () => {
    const cmd = btn.dataset.cmd;
    const value = btn.dataset.value || null;

    document.execCommand(cmd, false, value);
    editor.focus();
  };
});

formatBlock.onchange = () => {
  document.execCommand("formatBlock", false, formatBlock.value);
  editor.focus();
};

/* ===================== CODE BUTTON ===================== */

document.getElementById("code-btn").onclick = () => {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  const text = sel.toString();

  const codeEl = document.createElement("code");

  if (text) {
    codeEl.textContent = text;
    range.deleteContents();
  } else {
    codeEl.textContent = "code";
  }

  range.insertNode(codeEl);

  range.setStartAfter(codeEl);
  range.setEndAfter(codeEl);
  sel.removeAllRanges();
  sel.addRange(range);

  editor.focus();
};

/* ===================== SEARCH ===================== */

searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderList();
});

/* ===================== FINAL, DEBUGGED CODE ===================== */
editor.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") {
    // Szybkie wyjście, jeśli to nie jest Enter
  } else {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    const range = sel.getRangeAt(0);
    let startNode = range.startContainer;
    const element = startNode.nodeType === Node.TEXT_NODE ? startNode.parentElement : startNode;
    const blockquote = element.closest('blockquote');

    if (blockquote) {
      // SCENARIUSZ 1: CAŁY BLOCKQUOTE JEST PUSTY
      if (blockquote.textContent.trim() === '') {
        e.preventDefault();
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        blockquote.replaceWith(p);

        range.setStart(p, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      
      // SCENARIUSZ 2: WYJŚCIE Z CYTATU Z TREŚCIĄ (NOWA, POPRAWIONA LOGIKA)
      // Czekamy na domyślną akcję Enter (która wstawi <br> lub <div><br></div>)
      // i sprawdzamy stan *po* tym zdarzeniu.
      setTimeout(() => {
        const lastChild = blockquote.lastElementChild; // Bierzemy ostatni element w cytacie
        const secondToLast = blockquote.children[blockquote.children.length - 2];

        // Warunek wyjścia:
        // Czy ostatnie dwa elementy to puste bloki (np. dwa razy wciśnięty Enter)?
        // Przeglądarka może wstawiać <div><br></div> lub <p><br></p>
        if (
          lastChild && lastChild.textContent.trim() === '' &&
          secondToLast && secondToLast.textContent.trim() === ''
        ) {
          const newP = document.createElement('p');
          newP.innerHTML = '<br>';
          blockquote.after(newP); // Wstaw nowy paragraf PO cytacie

          // Usuń dwa puste bloki, które spowodowały wyjście
          lastChild.remove();
          secondToLast.remove();

          // Ustaw kursor w nowym paragrafie
          const newRange = document.createRange();
          newRange.setStart(newP, 0);
          newRange.collapse(true);
          const newSel = window.getSelection();
          newSel.removeAllRanges();
          newSel.addRange(newRange);
        }
      }, 0); // `setTimeout(..., 0)` wykonuje kod tuż po aktualizacji DOM przez przeglądarkę

      return; // Zwróć, aby nie wykonywać logiki dla ---
    }
  }
  
  // Ta logika jest wywoływana, tylko jeśli nie jesteśmy w `blockquote` i wciskamy Enter
  if (e.key === "Enter") {
    const lineText = getCurrentLine().trim();
    if (/^---$/.test(lineText)) {
      e.preventDefault();
      clearCurrentLine();
      document.execCommand("insertHorizontalRule");
      setTimeout(() => document.execCommand('insertParagraph'), 0);
      return;
    }
  }


  // ===== Pozostałe skróty (bez zmian) =====

  if (e.key === " ") {
    const line = getCurrentLine().trim();
    if (/^#{1,3}$/.test(line)) {
      e.preventDefault();
      clearCurrentLine();
      document.execCommand("formatBlock", false, "h" + line.length);
      return;
    }
    if (/^[-*]$/.test(line)) {
      e.preventDefault();
      clearCurrentLine();
      document.execCommand("insertUnorderedList");
      return;
    }
    if (/^1\.$/.test(line)) {
      e.preventDefault();
      clearCurrentLine();
      document.execCommand("insertOrderedList");
      return;
    }
    if (/^>$/.test(line)) {
      e.preventDefault();
      clearCurrentLine();
      document.execCommand("formatBlock", false, "blockquote");
      return;
    }
  }

  if (e.ctrlKey || e.metaKey) {
    switch (e.key) {
      case "b": e.preventDefault(); document.execCommand("bold"); break;
      case "i": e.preventDefault(); document.execCommand("italic"); break;
      case "`": e.preventDefault(); document.getElementById("code-btn").click(); break;
      case "X": if (e.shiftKey) { e.preventDefault(); document.execCommand("strikeThrough"); } break;
    }
  }
});

/* ===================== PASTE CLEAN ===================== */

editor.addEventListener("paste", (e) => {
  e.preventDefault();
  const text = e.clipboardData.getData("text/plain");
  document.execCommand("insertText", false, text);
});

/* ===================== SAVE ===================== */

function saveAll() {
  browser.storage.local.set({ notes });
}

// tooltip
const toggleBtn = document.getElementById("toggle-shortcuts");
const tooltip = document.getElementById("shortcut-tooltip");

if (toggleBtn && tooltip) {
  toggleBtn.onclick = () => {
    tooltip.classList.toggle("show");
  };
}