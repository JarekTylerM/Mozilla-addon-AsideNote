# Próbki schowka: AsideNote ⇄ ClickUp ⇄ Outlook

Źródło: notatka „Próbka formatowania” (treść: `tests/fixtures/format-sample.html`),
17 ponumerowanych sekcji — numer pomaga dopasować zrzut do sekcji.

## A. AsideNote → ClickUp / Outlook

1. W podglądzie panelu otwórz notatkę „Próbka formatowania”, kliknij w treść,
   `Ctrl+A`, `Ctrl+C`.
2. Wklej do opisu nowego zadania w ClickUp i do nowego maila w Outlooku.
3. Zrzuty ekranu: cała wklejka (kilka zrzutów, jeśli trzeba).
4. Gałąź DOM — wklej do pliku obok:
   - **ClickUp** → `clickup-dom.html`: DevTools (F12), zaznacz edytor opisu
     (element z klasą `ql-editor`), PPM → Copy → Copy outerHTML.
   - **Outlook w przeglądarce** → `outlook-web-dom.html`: DevTools, zaznacz
     treść maila (div z `aria-label` „Treść wiadomości” / „Message body”),
     Copy outerHTML.
   - **Outlook na komputerze** nie ma DevTools — wystarczy krok B.

## B. ClickUp / Outlook → AsideNote (powrót)

W ClickUp i w Outlooku zaznacz całą wklejkę z kroku A, `Ctrl+C` i wklej do
nowej notatki w podglądzie panelu (`Shift+Enter` w polu szybkiego dodawania
tworzy notatkę). Sonda w podglądzie zapisuje surowy schowek sama — nic nie
trzeba kopiować ręcznie. Zrzut notatki po wklejeniu też się przyda.
