// background.js

// Nasłuchuj na komendę zdefiniowaną w manifest.json
browser.commands.onCommand.addListener((command) => {
  // Sprawdź, czy to nasza komenda do przełączania panelu
  if (command === "toggle-sidebar") {
    // Otwórz lub zamknij panel boczny
    browser.sidebarAction.toggle();
  }
});