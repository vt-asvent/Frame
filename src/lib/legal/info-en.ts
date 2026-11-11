// ============================================================
// Versión inglesa de «Información y novedades» (1.6.7). El texto español
// (info.ts) es el que manda; este lo traduce fielmente. Al cambiar uno, se
// cambia el otro.
// ============================================================

import { TERMS_VERSION } from './versions.ts';

export function infoDocumentEn({
  appVersion,
  installId,
  releaseDate,
}: {
  appVersion: string;
  installId: string;
  releaseDate: string;
}): string {
  return `# Frame

**Version ${appVersion}** · Stable channel · Build ${appVersion} (NSIS x64) · ${releaseDate}
Academic productivity system for Windows and Android
Developed by **Asvent**, a software development entity in formation · Peru

Available in Spanish, English, German, French, Italian, Portuguese, Russian and Japanese (Settings → “Language”).

Frame brings together in a single application what usually takes five: managing subjects and tasks, timing your study with a daily grade, habit tracking, a calendar, a player for your own music, voice recording and Google’s services. Its academic core works offline, all your information is saved first on your own computer and, with an account, it syncs in seconds with Frame for Android.

---

## 1 · System requirements

**Operating system.** Windows 10 version 1809 (build 17763) or later, or Windows 11, on x64 computers. For tablets and phones there’s **Frame for Android** (Android 8.0 or later), downloaded from the same page and sharing account and data. There’s no version for macOS, Linux or iOS.

**Required component.** Frame uses the **Microsoft Edge WebView2** runtime, distributed by Microsoft and included by default in Windows 11 and in up-to-date Windows 10 installations. If it isn’t present, the installer detects it and asks to install it. Without this component the application doesn’t start.

**Resources.** 4 GB of memory and 300 MB of free space, plus the space taken by your music library and your recordings, which grows with no limit set by the application.

**Internet connection.** It isn’t needed for the academic core —subjects, tasks, study sessions, habits, the local calendar, your music and your recordings—. It is needed to create your account and sign in —once inside, all of the above keeps working without it—, for cloud sync, the YouTube, Gmail and Classroom screens, study videos, the weather card and checking for updates.

**System permissions.** Frame asks for access to the microphone for voice recording, to the file system for attachments, covers, reports and the music library, and for permission to show native notifications and an always-on-top window above other applications (the clock’s floating view). These permissions are used only for the functions described.

---

## 2 · Your account identifier

**${installId}**

It’s a twelve-digit **pseudonymous** identifier, the same one the Terms call the “installation identifier”. It’s derived from the internal, random code that the account service assigned to your account when it was created; for local profiles from before version 1.4.9 it was generated at random when the profile was created. It isn’t derived from your name, your email, your hardware or any data from your computer, and on its own it doesn’t identify you.

It has a single purpose: making sure a support report or a request about your data is linked to the right account without you having to give your email. You can also see it in Settings, next to your profile, and it’s copied with one click. Always include it when you write to support. Don’t post it on forums or social media: although it doesn’t identify you, it does uniquely identify your account.

Since it belongs to your account, it’s the same on every computer where you sign in and it doesn’t change even if you uninstall and reinstall Frame.

---

## 3 · Where each piece of data lives

Frame distinguishes three storage places. Knowing the difference is what prevents an irreversible loss.

**On your computer, always.** Everything you record is written first to your disk: subjects, collections, tasks, attachments, study sessions, grades, habits, local calendar events, resources, images, voice recordings and your music library. Recordings are also kept as audio files (M4A) in \`Documents\\Frame\\Grabaciones\`, accessible outside the application.

**In your account, if you signed in.** Your **academic state** —subjects, tasks, sessions, grades, habits, events, schedules with their classes, playlists with their order, study videos and settings— is replicated in the cloud and merged across devices: each change reaches your other devices in under a second, encrypted. This replica is what lets you switch machines, or use your phone, without losing anything. The **language**, the **image proportion** of the cards and the weather city you pick by hand also follow your account; the theme belongs to each device. Your **profile picture** and your **schedule photos** travel in a private folder of your account; the images from **Frame’s gallery** that you give your playlists, subjects and collections travel as a reference (which one it is and how you cropped it) and each device recreates it. Settings → **“Devices”** shows on which devices your account is open, whether they all have the same data and, if not, fixes it.

**Nowhere but your computer, always.** **Music** (with its covers and lyrics), **voice recordings**, **attachments** and **the images you upload yourself** to playlists, subjects and collections are excluded from the cloud because of their size. Your **listening stats** don’t leave your computer either. To have your music on another device, copy your files there and import them, or turn on **Wire**: it carries your songs, attachments, resource files and your own images to your other devices through your Google Drive, from which it deletes them as soon as they all have them (it’s a relay, not a backup). The bell tells you what isn’t the same on your devices, where and why (sync checker).

**A guest profile has nothing in the cloud.** “Continue as a guest” creates a local profile to try Frame instantly: all of its information lives only on this computer. To keep it safe, link your account with Google or with your email (the “G” next to your profile, at the bottom of the menu, or Settings → gear → “Link my account”): everything moves to your account, is added to what it already had without deleting anything and gets backed up.

---

## 4 · What this version includes

### 4.1 Academic core

Subjects with a cover image, groupable into collections, with a teacher and their own statistics; resources (notes, links, files and recordings) arranged in their own tab, and a permanent record of what was completed.

The **“+”** button in the top bar creates a task or a note without going to the subject; a note with no subject stays as a card at the bottom of Home. Tasks with a description, subject, due date, priority, type, difficulty, estimated time and a progress percentage that you can adjust by hand or that rises on its own with your study sessions in proportion to the estimated time. Reminders task by task, with days, time and repetition. Attachments linked to the original file on your disk —chosen with one click or dragged, one or several, onto the “Attach file” box—: if you keep editing it, Frame always sees the current version.

An archive of completed and incomplete tasks, with time spent and punctuality; a daily notice of overdue tasks to reschedule, complete or drop them. Next to “Filters”, how many tasks you see and how much their estimated time adds up to.

**Import from Notion** (Settings → account gear) brings your tasks and dates from the export of a Notion database (the .zip or the .csv), without connecting to your account.

### 4.2 Study and measuring your study

Timer or stopwatch, with an always-visible **floating view** in two sizes. In **performance mode** you rate your concentration from 1 to 20 and Frame calculates the day’s grade (AD, A, B, C); in **time mode** only the minutes against your goal count.

When you finish, the form records the exact time, your focus, the subjects and tasks you worked on and **what you did, with a text editor with bold, italics and lists**; subjects and their tasks are chosen with cards. During the session you can log progress with its minute. If Frame closes with a session running, when you come back the same day you can resume it.

Each session is a card with its subject, its time and its performance, and it opens with all its detail. A grades calendar with the detail of each day (time against the goal, sessions, average focus, grade and when you studied: morning, afternoon or evening), weekly or monthly academic progress and YouTube study videos, watched with its player.

### 4.3 Analysis and reports

The top bar shows phrases with your recent data that change on their own. Home sums up your day: your **schedule** —the day’s line with the current class always in the middle, each class with its subject’s image, its teacher, its tasks and its time; the week as a calendar and the original photo, one schedule per month—, the weather, “Pending tasks” (the two due soonest), a Pomodoro with its timer and its stopwatch and what you studied today and yesterday, your most-played playlist and your streak; in Advanced mode, also “Your week in data”: pace with the weekly average, consistency and completed tasks. Habits with times of day, rings, a typical week and a consistency map. Performance and pending-tasks **reports** in PDF and Word —weekly, monthly or yearly—, in Settings, with a summary and the real preview of the document.

### 4.4 Calendar, Google and music

An offline local calendar, with cells that adapt to the window’s height: one-day or multi-day events, with a time and the same reminder as tasks (days, time and repetition), cell colors and selecting several days at once by dragging; **YouTube, Gmail and Classroom** built into the sidebar, and **Drive** under Classroom while Wire is on. A library with **your own music**: “Import” brings loose songs or whole folders from your computer —MP3, M4A, AAC, OGG, Opus, FLAC, WAV and WebM— with their cover (the one the file carries, an image with the same name or the folder’s) and their lyrics (the ones in their tags, or an .lrc or .txt with the same name); it separates the title from the artist even if the file has no tags and warns you about what it can’t play. It plays with synced lyrics —which you can also add later, from a file of yours, in “Now playing”, and see **translated** into Frame’s language, line by line—, playlists with their total length and favorites, and **“Your music in numbers”**: how much you listen to each song, playlist and artist by week, month or year, counting only what really plays; clicking the playlist name in the player finds the song that’s playing. Voice recording from any screen (\`Ctrl+Shift+F\`), with the limit you choose, up to 4 hours. Updates show their size, the estimated time and the real progress before and during installation. With the **Library** extension, activated with a code sent to your school email, the menu gains **“Library”**: the collected material, with its featured guides, search, filters, favorites and downloading one or several files at once.

---

## 5 · Known limits and expected behavior

They’re documented here so none of them surprises you. They aren’t bugs.

Frame tells you about each new version (the “Update now” button and the bell) and **doesn’t install without your confirmation**.

Closing the window closes Frame. If a study session is running, it first offers to pause it, log it or keep studying. Reminders sound while Frame is open.

Document attachments stop resolving if the original file is moved, renamed or deleted: attach it again.

The daily grades are calculated exclusively from the data you record. They don’t come from any institution and have no academic validity.

Music, recordings, attachments and the images you upload yourself aren’t backed up in the cloud: they stay on the device where you added them.

On its own, Frame doesn’t search for or download music, videos, covers or lyrics: it shows the lyrics and cover that your files carry or the ones you add; what earlier versions already saved on your computer is kept. If you turn on a download extension, Frame installs the third-party program that comes with it on your computer —only if it’s signed by its author— and keeps it up to date (in the Microsoft Store version you install it yourself); Music’s “+ Add” asks it for each song you add, and it’s that program that downloads it (as a 320 kbps MP3) and queries public lyrics and cover services to complete it; Frame only imports the file it hands over. With it, “Add music” also reads a list by its **link** —from Spotify, Deezer, YouTube or Apple Music— or by its CSV: from Spotify and Apple Music, which only show the first 100 songs by link, longer lists are brought in with their CSV. Formats that the Windows audio engine doesn’t play (WMA, AIFF, ALAC, APE and others) aren’t imported, and Frame tells you which ones were left out.

Google’s screens require a connection and being signed in to Google, and how they work depends entirely on Google.

Reading the classes in a schedule requires a connection and a Frame account, and each account can read up to 6 photos a day. The AI can make mistakes: check what it read in “Week”.

Translating lyrics requires a connection and a Frame account; each account can translate up to 30 lyrics a day, and each one is requested only once (it stays saved on your computer). Lyrics that are already in Frame’s language aren’t sent.

The Library is for school accounts and needs a connection; each account can download up to 300 files or 3 GB a day.

---

## 6 · Third-party components and services

Frame is built on third-party software distributed under open licenses, listed in full in the **Third-party notices** section of the Terms and Conditions.

Google’s services —Gmail, YouTube, Classroom and Drive— are operated by Google LLC; their availability, content and terms depend on Google. Cloud backup and authentication run on **Supabase** infrastructure.

The weather forecast comes from **Open-Meteo**.

Web AI chats (claude.ai, ChatGPT and others) reach Frame through a relay hosted on **Cloudflare**, which passes each call along without storing it (Privacy Policy, 3.7). Schedule reading uses the open models **Qwen 3.8** and **Gemma 4** (Apache 2.0 license) on **Cloudflare Workers AI**, which doesn’t store the photos (Privacy Policy, 3.8); lyrics translation uses Gemma 4, and they aren’t stored either (3.10). The Library’s material arrives through that same Frame service on Cloudflare (3.11). Claude is a trademark of Anthropic, PBC; ChatGPT, of OpenAI; Gemini and Gemma, of Google LLC; and Qwen, of Alibaba Group. Frame isn’t affiliated with or endorsed by those companies.

Notion is a trademark of Notion Labs, Inc.; the extension only reads the files you export yourself and doesn’t connect to its service.

Spotify, Deezer, YouTube and Apple Music are trademarks of their owners. When reading a list by its link, Frame queries that list’s public page from your computer, without your account on that service; it isn’t affiliated with those companies or endorsed by them.

Frame **plays audio files present on your computer**. The application doesn’t provide a music catalog or any license over protected works: you’re responsible for holding the necessary rights over the files you add to your library.

---

## 7 · Version channel and update cycle

Frame is distributed on a single, **stable** channel. Numbering follows the \`MAJOR.MINOR.PATCH\` scheme. When an update changes the data format, Frame migrates it automatically on the first launch.

Support is offered for the current stable version and the one immediately before it. Older versions may stop syncing with the backup service without individual notice.

---

## 8 · Version history

**${appVersion} — ${releaseDate}**

*1.9.6:* **Wire, built to withstand anything** (and, from Frame mobile 1.3.5, on the phone and the tablet too): what comes down from your Drive is checked before it gets in, and what goes up is confirmed to have arrived whole · a song left without its audio repairs itself from your other devices, and losing the music store is no longer taken for “you deleted everything”: only what you delete on a device stops coming back to it · with many songs queued they no longer arrive duplicated (a 1.9.5 bug) · if you delete the “Frame · Wire” folder from your Drive another is created, and if two devices create one at once they end up in the same one · the time that counts is Drive’s: a wrong clock no longer leaves any device out · offline it doesn’t insist; if Google asks to slow down, it waits; and if the permission was withdrawn, it tells you with a button to **reconnect** · **your Drive doesn’t fill up**: what waits there is capped and free space is always left · it warns you if another device uses a different Drive account or an older Frame.

*1.9.5:* **your account no longer disconnects on its own**: Frame no longer mistakes a network hiccup, a server wait or the school Wi‑Fi sign-in page for a “closed session”, nor gets confused when the device clock is wrong or storage runs out; when the cloud rejects a key that had simply just expired, Frame renews it and repeats the request without you noticing (the Library, the schedule reader, lyrics translation and AI chats) · if it really is closed (for example, after a password change), you know right away and **reconnect without leaving where you are**, from the bell or from Settings → Devices: your data and what you had open stay put.

*1.9.4:* **Schedule**: each card carries its subject’s image with the proportion you chose in Subjects and, below, only its name; when reading the photo, Frame recognizes which subject each class belongs to even if it’s written differently (“Mat. AyE” is “Matemática”) and, when in doubt, asks you once; tapping a card changes it · **Library**: the extension is now called that, shows up when you search for it and is activated with a code sent to your school email, whichever email you sign in to Frame with; at the top, “Featured”: each subject’s guides in a carousel, with their preview · a simpler **“Add music”**: you paste the link to a song or a playlist, see what it is and how much it weighs, and “Download”; on the right, what’s downloading · Terms and Privacy Policy 5.8: sections 3.8 (schedule) and 3.11 (Library) and clause 15.3 (security software).

*1.9.3:* pop-up windows can no longer be taller than the screen: on short screens, the one for installing an extension left its buttons out of reach.

*1.9.2:* **Devices** in Settings: on which devices your account is open —laptop, phone or tablet—, whether they all have the same data and a button to fix it · **Wire** also carries the images you upload to subjects, collections and playlists, deletes from Drive what’s already on all your devices and tells the others right away · **Library** (AK Lore extension, for school accounts): the material in cards, with search, filters, favorites and downloading one or several files · **“Add music”** reads a list by its link —Spotify, Deezer, YouTube and Apple Music— or by its CSV (Exportify, TuneMyMusic, Soundiiz, Takeout, iTunes), saves it as a CSV and downloads all of it: no repeats, with retries, “Cancel all” and an automatic pause if the connection fails or the computer runs out of space · **lyrics translation** into Frame’s language, line by line · **Home**: the schedule with each class’s image, teacher, tasks and time; a taller Pomodoro, with a timer and a stopwatch; “Consistency” and “Completed tasks” side by side · **a sturdier session**: signing in and out no longer hang if the network fails, and sync recovers by itself within seconds when it’s back · Terms and Privacy Policy 5.7: sections 3.9 (devices), 3.10 (lyrics translation), 3.11 (Library) and 6.3 bis (Wire).

*1.9.1:* **schedules are read better**: Frame uses Qwen 3.8, which gets almost every class right even in skewed or blurry photos, and Gemma 4 when Qwen doesn’t respond or the daily free limit is near · Terms and Privacy Policy 5.6: section 3.8 names both models.

*1.9.0:* **Schedule on Home**: upload the photo of each month’s schedule (“November”, “November 2”…) and Frame reads its classes with AI; the day’s line always puts the current class in the middle, with the ones before and after on each side, and moves with the clock · **“Week”**: the week as a calendar, where you correct or add classes with a click · **“View original”**: the photo as it is · **Home rearranged**: schedule, weather, “Pending tasks” with the Pomodoro, the playlist and the streak to its right, and “Your week in data” with the pace on the left half; the competency matrix is retired · **Music → “+ Add”** is a page of its own, with YouTube on the left at three fifths of the width · **download extensions** install, open and update their program on their own, and repair it if it fails · **lighter**: its own charts instead of a library of almost 400 KB, gallery images 26% lighter and a start-up that loads less code, with every feature intact · **Terms and Privacy Policy 5.5**: section 3.8 explains schedule reading and 6.4 bis, the download extensions’ program.

*1.8.1:* **Music → “+ Add”** with a download extension: YouTube embedded on the right and, on the left, the download queue with “Add” (the video you have open) and “Start download”; each song as a 320 kbps MP3 with its official cover and lyrics, and the size of each one · **song CSVs** (for example, a Spotify playlist): a summary before starting and its playlist in the same order · **download indicator** next to “Shuffle”: downloaded, remaining and failed songs, the speed and how good it is, the total size, the time left and a pause · the download keeps going when you close the window or switch screens, and continues when you open Frame again · **Terms and Privacy Policy 5.4**: section 6.4 bis explains download extensions.

*1.8.0:* **Your music in numbers**: how much you listen to each song, playlist and artist by week, month or year —only what really plays, and without leaving your computer—, with the plays and time of each playlist and of the song in “Now playing” · **A new Home**: a Pomodoro with what you studied today and yesterday, your most-played playlist, your streak and “Pending tasks”; in Advanced mode, pace, consistency and completed tasks · in Settings, Advanced mode is explained in one line · **Extensions** at a third of the width, with a search bar that counts the ones in use and a page of their own for each · **Animations**: Northern lights, Rising Matrix, Type aurora and Shape mosaic; shapes in the sidebar and the header, background image framing and heading font · **web AI chats**: claude.ai, ChatGPT and other chats with connectors drive Frame through its cloud (Privacy Policy 5.3) · **Drive** in the menu, under Classroom, with Wire’s account.

*1.7.6:* **Extensions as cards** with a preview (videos play on hover) · third-party extensions enabled for everyone that appear when you **search for them by name** · with a compatible download extension, “Import” opens its own window: YouTube video, **320 kbps MP3 download** with cover and lyrics, or a song **CSV** · in Settings, a **custom color** with a professional picker (HEX, RGB, HSL, eyedropper) and a **comparison** of what Advanced mode changes · Wire and AI Connections show their logos · smaller logos in the sidebar and the title bar.

*1.7.5:* after updating, Frame **leaves no traces** of previous versions on your computer · the sidebar logo shows in full.

*1.7.4:* **final Frame logo** in the app, the taskbar, the installer and the website · **Extensions** move out of Settings into their own section, with a search box: each one is a row with its switch and its own panel (Wire, with its live relay inside).

*1.7.3:* **six more languages**: German, French, Italian, Portuguese, Russian and Japanese, besides Spanish and English; the legal documents remain authentic in Spanish · **extensions**: a hub in Settings to install, turn off or remove features without a trace; third-party ones are data only (never code) and ask for their permissions when installed · **Wire** takes your songs and attachments to your other devices using your Google Drive as a relay, and removes them from Drive once they all have them · **Animations**: the constellation is back, along with Waves and Aurora, with your own background image and appearance mods · **AI connections**: Claude, Gemini and other desktop AIs can use Frame on this computer, and Frame asks you to confirm before deleting · **AK Lore**: search, view and download the guides from the school’s collected material, with the school account · **Notion** becomes an extension, creates the missing subjects and duplicates nothing when importing again · Music → Import → **Download**, with a downloads extension · **Advanced mode**: Frame shows the essentials and the switch in Settings adds Performance mode, grades, daily goals and reports; hiding it deletes nothing · **new identity**: Frame logo, navy accent (eight colors in Settings → Theme) and the maker is now called Asvent · the window opens the way you closed it · on Home, each task without a subject takes half a row · **playlists**: reordering them on one device no longer gets undone on another or loses copies.

*1.7.2:***getting into Frame is almost instant**: Home is drawn with what you already have on the computer and the cloud syncs in the background, instead of waiting up to 12 seconds before showing anything · **required updates**: each published version sets the minimum that keeps working; an older Frame shows the notice on opening (also when you come back to it and when the connection returns) and won’t let you close it until you install, though it waits if you’re studying, recording or listening to music · the new-version notice no longer depends on the app having been open for a while: it checks after 2 seconds and remembers the known version between launches · **the heart on songs always travels**: the change notice goes through a path that doesn’t depend on the live connection being open, the background check goes from five minutes to one, and a race was fixed in which a change arriving from another device in the middle of an upload brought back a heart you had just removed · **the 89 gallery images, redrawn at 960 pixels**: 1.7.1 had compressed them too much; now they are sharp and weigh about 70 KB each.

*1.7.1:* the **Terms and Privacy Policy 5.2** no longer mention Drive or imported schedules, which Frame no longer has.

*1.7.0:* **importing music with subfolders**: each song finds its lyrics (.lrc or .txt) and its cover even if they are in other folders (“Lyrics”, “Covers”…), with names that don’t match letter by letter (“01 - Song” and “song.lrc”, with or without accents, “Artist - Title”); songs with the same name in different folders (CD1 and CD2) are no longer lost; also .m4b, .jfif and .gif · habit consistency only counts the days each habit is due and since you created it, and creating a new one no longer sinks your streak or record · the same streak on Home and in Settings · a damaged date coming from another device no longer prevents Frame from opening · a deletion you can still undo no longer reappears when changes arrive from another device · less traffic with the cloud (checks spaced out, images uploaded reduced) and update checks every 6 hours · Frame no longer stores Google tokens on the computer · copies of attachments marked as downloaded from the Internet · Focus’s floating window opens faster · a lighter Frame: less code, and legal texts that load when you open them · the usage panel for the person responsible leaves the app.

*1.6.9:* the **gallery images** you give subjects, collections and playlists finally appear on your other devices (they arrived but weren’t drawn) · **the heart on songs** travels between your devices too, by title and artist · Frame keeps whatever a newer version adds to your backup, even if it doesn’t use it · an in-depth **Usage panel** for the person responsible for Frame: world map, continents, countries and cities, a card per student with their details, periods from one day to a year or of your choice, the hours when people study, which features are used, cohort retention and a **Report** in Word, PDF or Markdown · Terms and Privacy Policy 5.1: the usage profile that is sent (approximate city, time zone, languages, device type, study hours and how many items you have in each feature, never their content).

*1.6.8:* **sync, in depth**: each change reaches your other devices in under a second, encrypted, through your account’s channel, and the cloud receives only what’s needed; the backup is no longer resent nonstop · now **the order of playlists and of their songs**, **the language**, **the image proportion** of the cards, the weather city picked by hand, **study videos** and the images from Frame’s gallery in subjects, collections and playlists (as a code, not the whole image) travel too; the images you upload yourself stay on their device and Frame explains why · **sync checker** in the bell: how many things aren’t the same on your devices, where and why · if two devices change the same thing, the most recent change wins, even if one of them was offline · **Gmail and Classroom** let you sign in again · **calendar**: the month and its arrows with more room, and cells that adapt to the window’s height; a more compact “New event”, with the time and **the same reminder as tasks** · **Settings** in order also with Frame on half the screen; in Reports, neutral selectors, “PDF” in gray and “Word” in blue · background without the constellation · side menu with less margin at the top and bottom · Terms and Privacy Policy 5.0: which images travel and which don’t.

*1.6.7:* **Frame in English**: Settings → “Language” switches the whole app between Spanish and English instantly, without restarting · **redesigned calendar**: centered month with arrows only, shorter cells and thin borders; “New event” with the type in a drop-down (including one you type yourself), resources, “All day” that paints the cell, a color picker and a formatted note; when clearing several days with more than one activity, a list to check what gets deleted · the detail of each **study session**, with its data in three thirds · **privacy between profiles**: each account on the same computer sees only its own music, its schedule image and its weather · **Frame weighs less**: cleaned-up code and recompressed images · the sign-in screen, without the ring that followed the cursor · **your music, in depth**: Frame reads the tags of MP3, M4A, FLAC, OGG, Opus, WAV and WebM —title, artist, album, cover, lyrics (synced ones too) and length—, separates the title from the artist even if the file has no tags, uses the folder’s cover if the song has none and warns when importing about what it can’t play and why · **lyrics are yours alone**: Frame stops searching for them online; it shows the ones the song carries or the ones you add from an .lrc or .txt file in “Now playing” · **playlists** show their total length and their header blends the image into the background with no cuts · **Tasks**: next to “Filters”, how many tasks you see and how much their estimated time adds up to · the **Help center** is retired · the background word stays only in the boxes that open with a click, and still; it only moves in each subject · the stacked formatting buttons are as tall as the writing box · in Music, no arrows at the bottom of the list · Terms and Privacy Policy 4.9: no lyrics services or conversations with the help.

*1.6.6:* **Help center** by topics and questions, with no bar or history, with a **dodecahedron** that spins sideways and phrases that change at 6, 12 and 18 o’clock · **each subject**: “Classes” becomes **“Resources”** (notes, links, files and recordings, in order) and the monthly schedule is retired · **cropping** with the whole image in view and what isn’t used, darkened · cards keep the image **proportion** you choose · **Home**: “Yesterday”, “Weekly average”, “Streak days” and “Next task” redesigned · **Settings**: “Your streak” under Performance and Time, with **Reports** to its right · headers with a divider line and a background word in every box · text without sustained capitals · note formatting without underline, undo or redo · Terms and Privacy Policy 4.8: the schedule-import clause is removed.

*1.6.5:* **the help’s answers, rewritten** for beginners: friendly, in paragraphs, with bold text and saying where each button is; it understands more ways of asking · “Show me how” is retired · the help’s figure is now a **soccer ball**, “Related” folds away and the button gets a new **two-star** icon · **“New note”** and recordings, with the formatting buttons stacked on the left · **tasks**: buttons in the order date, type, priority, difficulty, estimated time, reminder, document and link; **“Attach file”** with one click or by dragging several files; the estimated time is picked with hour and minute wheels · collection and subject cards follow the **image height** you choose (up to 200) on every screen · **each session’s detail** with its subject’s image from edge to edge · Privacy Policy 4.7: it no longer mentions the “Discover” tours, which no longer exist.

*1.6.4:* **Help center** with “History” on the left (by day), a figure of pentagons that breathes while you type, rotating phrases and a new **“Fun facts”** topic · **the bell keeps a log** of your notifications, with their time, and a gear for the sound, turning them on or clearing them · **“New note”** and the description of recordings with formatting buttons like in Word · **“Save recording”**: priority and **audio type** in drop-downs · **lyrics recognized online return** · **89 new images** in the gallery · a gear in Subjects for the **image height** · the corner notices no longer get stuck when minimizing · when a session ends in the floating view, Frame comes to the front.

*1.6.3:* **renewed Help center**: a conversation like in a chat, topics on cards instead of guessing the question, “Show me how” and “New conversation”, with its button in the top bar · **Reports in Settings**: performance and pending tasks, weekly, monthly or yearly, with a summary and the **real preview** of the document · **side menu** in three blocks · **Calendar** local only and with the grid of the Study calendar: Frame stops connecting to Google Calendar · cancel and discard buttons in gray; red only for confirming a deletion · the Study timer, centered · “Create” respects the dark theme.

*1.6.2:* **the top bar talks about you**: phrases with your recent data that change on their own · **Reports center** in the top bar · **notes without a subject** on Home · **Study**: session cards with their detail, a Word-like text editor, subjects and tasks chosen with cards · **redesigned local calendar**: several days at once, reminders and cell colors · recordings with the limit you choose (up to 4 h) · **updating** shows size, estimated time and real progress · Settings with a small account menu and “Import from Notion” · the Help keeps one conversation each time you open Frame · **fixed**: Music’s “Import” didn’t open the file explorer (“current webview is not a WebviewWindow”).

*1.6.1:* **the Help gets its own screen**: a round button at the bottom right opens it full screen, with the menu and the top bar in view, and Apex next to the bar; your questions stay in “Conversations” · **a lighter Home**: the sphere is gone · **“Focus” is renamed “Study”** in the menu · **your music, from your computer**: Music’s “Import” button opens the file explorer to bring loose songs or whole folders, with their cover and lyrics; Frame stops downloading songs, videos, covers and lyrics · Music always starts at the top of the first folder of 100 when Frame opens · Subjects offers the ten areas of the **CNEB** · voice recordings are saved in M4A · **Frame weighs much less and uses less processor**: the installer drops to a fraction of the previous one and animations stop when they’re not visible · the presentation screen and “Export music” are gone.

*1.6.0:* the help answered full screen and kept your conversations · **“Discover”**: after the answer, a guided tour darkens the screen, lights up only the button that matters and moves along with you until the action is completed, with **Apex**, VT Asvent’s mascot, changing poses beside you · **the help understands many more questions**: typos, colloquial phrases and breakdowns (“won’t load”, “no sound”) included · new answers: music volume and controls, out-of-sync lyrics, tasks in the wrong subject and the most frequent problems.

*1.5.9:* **simpler code**: 17 % fewer lines, without the functions that were no longer used · **the calculator, dictionary and translator are gone**: the extensions keep the Notion importer · **“Suggestions” and “Educational Institution” are gone**: bugs and proposals are sent by email to vt.asvent@gmail.com.

*1.5.8:* **Home gets help**: a bar to ask in your own words how to use any Frame feature; it answers instantly and offline from a guide written feature by feature · when a session ends, “What did you do?” accepts a **list of progress items** as well as continuous text · the playlist name in the player **takes you to the song that’s playing** · **YouTube** returns to the sidebar · **fixed**: account images weren’t being uploaded to the cloud because of a file name the service rejected; now they do travel · failures that break a screen are reported automatically, with their location in the code and never with your content.

*1.5.6:* **linking your account, closer at hand**: anyone using a guest profile has a small “G” next to their profile, at the bottom of the menu; it opens the same sign-in box, with Google or with email and password, and everything of theirs moves to the account without losing anything · **“Offline”**: a brief notice at the bottom left that goes up to the bell and stays there as a notification; if the session was closed, you sign in again from it.

*1.5.5:* **images travel between your devices**: the profile picture, the schedule image and those of your playlists, subjects and collections appear on their own on your phone or tablet, and the other way around, in seconds · when cropping an image you can also zoom by pinching on a touch screen.

*1.5.4:* **live sync**: what you change on your phone or tablet appears on your laptop in a few seconds, and the other way around · **the session is no longer lost**: if the cloud closes your session on its own, you stay in Frame with your data and a strip offers to sign you back in · **crop images** with zoom, in a frame with the exact shape of the slot · the day in the grades calendar shows **when you studied** (morning, afternoon or evening).

*1.5.3:* **“Continue as a guest” is back**: you get in instantly, with no account or forms, to try Frame · **link with Google without losing anything**: everything the guest did moves to their account, is added to what it already had without deleting or duplicating, and gets backed up in the cloud.

Full history: on the Frame download page.

---

## 9 · Applicable documents

Terms and Conditions of Use and Privacy Policy, version ${TERMS_VERSION}, in force since ${releaseDate} · “Terms of service” screen
Acceptable Use Policy · Annex C of the Terms
Third-party software notices · Annex E of the Terms

Contact: vt.asvent@gmail.com · Asvent`;
}
