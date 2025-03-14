const now = new Date();
const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

function doGet() {
    let template = HtmlService.createTemplateFromFile("index");
    return template.evaluate();
}

// スプレッドシートにemail,timeを保存
function saveUser(time, email) {
    const spreadsheet = SpreadsheetApp.openById('1ii2MBtSLK5vmq9PNP6y0RBtvQsxwefstCfQ_HNoIFyI');
    const sheet = spreadsheet.getSheetByName('Sheet1');
    let range;

    const hasAlreadySaved = sheet.getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues().some(row => {
        if (row[0] == email) {
            range = sheet.getRange(sheet.getLastRow(), 2);
            range.setValue(time);
            return true;
        }
    })

    if (!hasAlreadySaved) {
        range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, 2);
        range.setValues([[email, time]]);
    }

    Logger.log(`Saved: ${email}, ${time}`);

    return "設定を保存しました";
}

function getAppUrl() {
    return ScriptApp.getService().getUrl();
}

function main() {
    const spreadsheet = SpreadsheetApp.openById('1ii2MBtSLK5vmq9PNP6y0RBtvQsxwefstCfQ_HNoIFyI');
    const sheet = spreadsheet.getSheetByName('Sheet1');
    const data = sheet.getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();

    data.forEach(row => {
        const email = row[0];
        const time = row[1];
        const hours = parseInt(time.split(":")[0], 10);
        const minutes = parseInt(time.split(":")[1], 10);

        if (now.getHours() == hours && (now.getMinutes() == minutes || now.getMinutes() == minutes)) {
            sendReminder(email);
        }

        Logger.log(`Email: ${email}, Time: ${time}, TriggerTime: ${triggerTime}`);
    });
}

function sendReminder(email) {
    const recipient = email; // 送信先メールアドレス

    const subject = `【リマインダー】本日更新された GoogleClassroom のお知らせ`;

    const template = HtmlService.createTemplateFromFile('mail_template');

    template.courses = getTodayUpdates();

    const html = template.evaluate().getContent();

    const bookIcon = DriveApp.getFileById("11lg5pY4xeIto0FOgm4wxkJFIlQgpdoaR").getBlob();
    const assignmentIcon = DriveApp.getFileById("1i25KhzDgdjsGiSBpQ6SuGf5Pnn0bxyrY").getBlob();

    // メール送信
    MailApp.sendEmail(recipient, subject, html, { htmlBody: html, inlineImages: { bookIcon: bookIcon, assignmentIcon: assignmentIcon } });
}

function getTodayUpdates() {
    now.setDate(now.getDate() - 1);
    now.setHours(now.getHours() + 9);
    const todayStr = now.toISOString().split("T")[0]; // YYYY-MM-DD
    now.setHours(now.getHours() - 9);
    Logger.log(todayStr);

    let courses = [];
    for (const id of Classroom.Courses.list({ 'courseStates': ["ACTIVE"] }).courses.map(course => course.id)) {
        Logger.log(Classroom.Courses.get(id));
        let coursePosts = [];
        const courseAnnounces = Classroom.Courses.Announcements.list(id).announcements;
        const courseWorks = Classroom.Courses.CourseWork.list(id).courseWork;
        const courseWorkMaterials = Classroom.Courses.CourseWorkMaterials.list(id).courseWorkMaterial;
        if (courseAnnounces != null) {
            coursePosts.push(...courseAnnounces);
        }
        if (courseWorks != null) {
            coursePosts.push(...courseWorks);
        }
        if (courseWorkMaterials != null) {
            coursePosts.push(...courseWorkMaterials);
        }
        coursePosts = coursePosts.filter(
            post => post.updateTime.split("T")[0] == todayStr
        ).map(post => {
            if (post.workType != null) {
                post["type"] = "WORKS";
            } else if (post.topicId != null) {
                post["type"] = "WORK_MATERIALS";
            } else {
                post["type"] = "ANNOUNCEMENTS";
            }
            return post;
        });
        const obj = {
            "courseId": id,
            "courseName": Classroom.Courses.get(id).name,
            "posts": coursePosts
        }
        courses.push(obj);
    }
    return courses;
}

function logScopes() {
    Logger.log(ScriptApp.getOAuthToken());
}

function toBrTag(text) {
    return text.replace(/\n/g, "<br>");
}





// Google Chat に通知（任意）
function sendGoogleChatNotification(message) {
    const webhookUrl = "YOUR_WEBHOOK_URL"; // Google Chat のWebhook URL
    const payload = JSON.stringify({ text: message });

    UrlFetchApp.fetch(webhookUrl, {
        method: "post",
        contentType: "application/json",
        payload: payload
    });
}