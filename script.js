const now = new Date();
const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

function doGet(e) {
    let template = HtmlService.createTemplateFromFile("index");
    const accountEmail = Session.getActiveUser().getEmail();

    var service = getService(accountEmail);
    if (service.hasAccess()) {
        const spreadsheet = SpreadsheetApp.openById('1ii2MBtSLK5vmq9PNP6y0RBtvQsxwefstCfQ_HNoIFyI');
        const sheet = spreadsheet.getSheetByName('Sheet1');
        let values;
        const exists = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().some((row, index) => {
            if (row[0] == accountEmail) {
                range = sheet.getRange(index + 2, 1, 1, sheet.getLastColumn());
                values = range.getValues();
                return true;
            }
        });
        Logger.log(values);

        if (exists === true) {
            const email = values[0][1];
            const timeDate = new Date(values[0][2]);
            const time = `${timeDate.getHours()}:${timeDate.getMinutes()}`;
            template.email = email;
            template.time = time;
            Logger.log(`Email: ${template.email}, Time: ${ template.time}`);
        } else {
            template.email = "";
            template.time = "";
        }
    } else {
        template.email = "";
        template.time = "";
    }

    template.activeUserEmail = accountEmail;

    return template.evaluate();
}

// スプレッドシートにemail,timeを保存
function saveUser(time, email) {
    const spreadsheet = SpreadsheetApp.openById('1ii2MBtSLK5vmq9PNP6y0RBtvQsxwefstCfQ_HNoIFyI');
    const sheet = spreadsheet.getSheetByName('Sheet1');
    let range;
    const accountEmail = Session.getActiveUser().getEmail();

    const hasAlreadySaved = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().some((row, index) => {
        if (row[0] == accountEmail) {
            range = sheet.getRange(index + 2, 1, 1, 3);
            range.setValues([[accountEmail, email, time]]);
            return true;
        }
    })

    if (!hasAlreadySaved) {
        range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, 3);
        range.setValues([[accountEmail, email, time]]);
    }

    Logger.log(`Saved: ${email}, ${time}`);

    const service = getService(accountEmail);
    if (service.hasAccess()) {
        Logger.log('already authorized');
        return null;
    } else {
        Logger.log('start authorization');
        return service.getAuthorizationUrl(accountEmail);
    }
}

function getAppUrl() {
    return ScriptApp.getService().getUrl();
}

function main() {
    const spreadsheet = SpreadsheetApp.openById('1ii2MBtSLK5vmq9PNP6y0RBtvQsxwefstCfQ_HNoIFyI');
    const sheet = spreadsheet.getSheetByName('Sheet1');
    const data = sheet.getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();

    data.forEach(row => {
        const email = row[1];
        const time = row[2];
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

// ここから下はOAuth2関連の関数

function getService(accountEmail) {
    if (accountEmail == null) {
        return null;
    }
    return OAuth2.createService('GoogleClassroom_' + accountEmail)
        .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/auth')
        .setTokenUrl('https://accounts.google.com/o/oauth2/token')
        .setClientId(PropertiesService.getScriptProperties().getProperty('CLIENT_ID'))
        .setClientSecret(PropertiesService.getScriptProperties().getProperty('CLIENT_SECRET'))
        .setCallbackFunction('authCallback')
        .setPropertyStore(PropertiesService.getUserProperties())
        .setScope('https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.announcements.readonly https://www.googleapis.com/auth/classroom.rosters.readonly https://www.googleapis.com/auth/classroom.coursework.students.readonly https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly')

        // Requests offline access.
        .setParam('access_type', 'offline')

        // Consent prompt is required to ensure a refresh token is always
        // returned when requesting offline access.
        .setParam('prompt', 'consent')

        .setCache(CacheService.getUserCache())
}

// OAuth2認証のコールバック関数
function authCallback(request) {
    var service = getService(Session.getActiveUser().getEmail());
    var isAuthorized = service.handleCallback(request);
    if (isAuthorized) {
        const spreadsheet = SpreadsheetApp.openById('1ii2MBtSLK5vmq9PNP6y0RBtvQsxwefstCfQ_HNoIFyI');
        const sheet = spreadsheet.getSheetByName('Sheet1');
        sheet.getRange(2, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues().some((row, index) => {
            if (row[0] == accountEmail) {
                range = sheet.getRange(index + 2, 4);
                range.setValue('True');
                return true;
            }
        })
        return HtmlService.createHtmlOutput('認証が完了しました。このウィンドウを閉じてください。');
    } else {
        return HtmlService.createHtmlOutput('認証に失敗しました。');
    }
}

// 認証を開始するための関数
function startOAuth2(email) {
    var service = getService(email);
    var authorizationUrl = service.getAuthorizationUrl(email);
    Logger.log('認証URL: ' + authorizationUrl);
    return authorizationUrl;
}