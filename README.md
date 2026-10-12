# Money Counter – aplikacja na iPhone'a (PWA)

## Instalacja przez GitHub Pages

1. Załóż na GitHubie nowe **publiczne** repozytorium, np. `money-counter`.
2. Kliknij **Add file → Upload files** i przeciągnij **całą zawartość** tego folderu (wszystkie pliki), a nie sam folder. Na dole kliknij **Commit changes**.
3. Wejdź w **Settings → Pages**. W polu *Source* wybierz **Deploy from a branch**, branch **main**, folder **/ (root)** i kliknij **Save**.
4. Po 1–2 minutach na górze tej strony pojawi się adres, np. `https://twojlogin.github.io/money-counter/`.
5. Na iPhonie otwórz ten adres w **Safari**, kliknij **Udostępnij** (kwadrat ze strzałką), a potem **Do ekranu początkowego** i **Dodaj**.

Od teraz aplikacja ma ikonę na ekranie, otwiera się na pełnym ekranie i działa bez internetu.

## Dane

- Wszystko zapisuje się tylko w telefonie i nic nie trafia na GitHuba.
- Usunięcie aplikacji z ekranu początkowego albo wyczyszczenie danych Safari kasuje dane.
- Kopię zrobisz w **⚙ → eksportuj kopię** (zapisz plik w aplikacji Pliki). Przywrócisz ją przez **importuj kopię**.

## Aktualizacja aplikacji

1. Podmień zmienione pliki w repozytorium.
2. W pliku `sw.js` zmień `VERSION` (np. `budzet-v1` na `budzet-v2`).
3. Na telefonie zamknij aplikację i otwórz ją ponownie, maksymalnie dwa razy.
