# YahavTemp — GitHub Pages build

גרסה מתוקנת שעובדת מאתר סטטי ב-GitHub Pages.

## תיקון מרכזי

הגרסה הקודמת השתמשה ב-Mail.tm ישירות מהדפדפן. במצבים שבהם ה-API
לא מחזיר CORS מתאים, Chrome חוסם את הבקשה ומציג `Failed to fetch`.

הגרסה הזו משתמשת ב-TempMailPortal API, שמצהיר על CORS פתוח ומיועד
לקריאות ישירות מ-JavaScript בדפדפן.

## קבצים להעלאה

החלף ב-Repository את:

- `index.html`
- `style.css`
- `app.js`

לא צריך Python, Render, Node.js או Backend.

## אחרי העלאה

GitHub Pages עשוי לקחת כמה רגעים להתעדכן. לאחר מכן:
- בצע Ctrl+F5
- ואם עדיין נטענת הגרסה הישנה, פתח DevTools > Application > Storage
  ונקה Site Data, או פתח חלון Incognito.

## שימוש

מיועד לפרטיות, בדיקות ופיתוח לגיטימיים. אין להשתמש בו לספאם,
הונאה, עקיפת מגבלות או יצירת חשבונות אוטומטית בשירותי צד שלישי.
