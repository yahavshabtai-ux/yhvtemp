# YahavTemp

אתר Temporary Email סטטי שאפשר להעלות ישירות ל-GitHub Pages.

## מה יש בפנים

- יצירת כתובת אימייל זמנית אמיתית
- אפשרות לבחור username
- Inbox שמתעדכן אוטומטית כל 7 שניות
- פתיחת הודעות
- זיהוי בסיסי של קודי אימות
- העתקת כתובת וקוד
- מחיקת הודעה
- מחיקת תיבה
- שמירת session מקומית בדפדפן
- Dark / Light mode
- Preview טקסטואלי בטוח שלא טוען HTML חיצוני/trackers

## איך מריצים במחשב

אפשר פשוט לפתוח `index.html` בדפדפן.

אם הדפדפן מגביל בקשות מקובץ מקומי, הרץ שרת מקומי:

```bash
py -m http.server 8000
```

ואז פתח:

```text
http://localhost:8000
```

## העלאה ל-GitHub Pages

1. צור Repository חדש ב-GitHub.
2. העלה אליו את `index.html`, `style.css` ו-`app.js`.
3. היכנס ל-Settings > Pages.
4. תחת Build and deployment בחר Deploy from a branch.
5. בחר `main` ואת `/ (root)`.
6. שמור.

אחרי כמה רגעים האתר יהיה זמין בכתובת GitHub Pages של ה-Repository.

## איך זה עובד

האתר משתמש ישירות ב-Mail.tm API:
- `GET /domains`
- `POST /accounts`
- `POST /token`
- `GET /messages`
- `GET /messages/{id}`
- `DELETE /messages/{id}`
- `DELETE /accounts/{id}`

אין API key ואין backend בפרויקט הזה.

## פרטיות ואבטחה

פרטי התיבה הזמנית (כולל token/password של התיבה הזמנית) נשמרים רק ב-localStorage של הדפדפן כדי שהתיבה תישאר זמינה אחרי refresh.

תצוגת ההודעות מציגה טקסט בלבד. היא לא מרנדרת את ה-HTML המקורי של המייל, כדי לצמצם טעינת משאבים חיצוניים ו-tracking pixels.

## שימוש

מיועד לפרטיות, בדיקות ופיתוח. אל תשתמש בשירות לפעילות בלתי חוקית, ספאם או עקיפה של מגבלות שירותים.

## Attribution

Email infrastructure powered by [Mail.tm](https://mail.tm/).

Mail.tm requires visible attribution when using its API.
