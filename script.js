const now = new Date();
const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

function doGet(e) {
    let template = HtmlService.createTemplateFromFile("index");
    const accountEmail = Session.getActiveUser().getEmail();

    var service = getOAuthService(accountEmail);
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
            const time = `${zeroPadding(timeDate.getHours())}:${zeroPadding(timeDate.getMinutes())}`;
            template.email = email;
            template.time = time;
            Logger.log(`Email: ${template.email}, Time: ${template.time}`);
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

    const service = getOAuthService(accountEmail);

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
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

    data.forEach(row => {
        const accountEmail = row[0];
        const email = row[1];
        const time = new Date(row[2]);

        if (now.getHours() == time.getHours() && now.getMinutes() == time.getMinutes()) {
            sendReminder(accountEmail, email);
        }

        Logger.log(`Email: ${email}, Time: ${time}`);
    });
}

function sendReminder(accountEmail, email) {
    const recipient = email; // 送信先メールアドレス

    const subject = `【リマインダー】本日更新された GoogleClassroom のお知らせ`;

    const template = HtmlService.createTemplateFromFile('mail_template');

    const service = getOAuthService(accountEmail);
    if (service.hasAccess()) {
        const accessToken = service.getAccessToken();
        template.courses = getTodayUpdates(accessToken);
        template.accessToken = accessToken;
    } else {
        Logger.log("Unauthorized");
        template.courses = [];
        template.accessToken = "";
        // ここで再認証を行うURLをテンプレートに渡して再認証させる
        // そもそものGoogle認証も、テストメールに含ませた方が理想的？
    }

    const html = template.evaluate().getContent();

    // メール送信
    MailApp.sendEmail(recipient, subject, html, { htmlBody: html });
}

function getTodayUpdates(accessToken) {
    now.setDate(now.getDate());

    let courses = [];

    const fetchedCourses = fetchWrapper(accessToken, "courses");

    for (const id of fetchedCourses.courses.map(course => course.id)) {
        if (getCache(id) != null) {
            courses.push(JSON.parse(getCache(id)));
            continue;
        }

        const classroom = fetchWrapper(accessToken, `courses/${id}`);
        Logger.log(`Classroom: ${classroom.name}`);

        let coursePosts = [];
        const courseAnnounces = fetchWrapper(accessToken, `courses/${id}/announcements`).announcements;
        const courseWorks = fetchWrapper(accessToken, `courses/${id}/courseWork`).courseWork;
        const courseWorkMaterials = fetchWrapper(accessToken, `courses/${id}/courseWorkMaterials`).courseWorkMaterial;
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
            post => isLatest(now, new Date(post.updateTime))
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
            "courseName": classroom.name,
            "posts": coursePosts
        }
        courses.push(obj);
        setCache(id, JSON.stringify(obj), 300);
    }
    return courses;
}

/**
 * 
 * @param {string} accessToken 
 * @param {string} url 
 * @param {object} payload 
 */
function fetchWrapper(accessToken, url) {
    const options = {
        method: "GET",
        headers: {
            'Authorization': 'Bearer ' + accessToken,
        }
    }

    try {
        const response = UrlFetchApp.fetch("https://classroom.googleapis.com/v1/" + url, options);
        return JSON.parse(response.getContentText());
    } catch (e) {
        Logger.log(e);
        return null;
    }
}

function testMail() {
    const spreadsheet = SpreadsheetApp.openById('1ii2MBtSLK5vmq9PNP6y0RBtvQsxwefstCfQ_HNoIFyI');
    const sheet = spreadsheet.getSheetByName('Sheet1');
    let range;
    const accountEmail = Session.getActiveUser().getEmail();
    let values = [];

    const hasAlreadySaved = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().some((row, index) => {
        if (row[0] == accountEmail) {
            range = sheet.getRange(index + 2, 1, 1, 3);
            values = range.getValues()[0];
            return true;
        }
    })

    if (!hasAlreadySaved) {
        return false;
    }

    const email = values[1];
    const html = 'メール送信テストです。'
    try {
        MailApp.sendEmail(email, "【Classroom Summary Notification】テストメール送信", html);
        return true;
    } catch (e) {
        Logger.log(e);
        return false;
    }
}

function logScopes() {
    Logger.log(ScriptApp.getOAuthToken());
}

function toBrTag(text) {
    return text.replace(/\n/g, "<br>");
}

function isLatest(today, target) {
    const diff = Math.abs(today.getTime() - target.getTime());
    return diff < 1000 * 60 * 60 * 24; // 1日;
}

function setCache(key, value) {
    CacheService.getScriptCache().put(key, value);
}

function getCache(key) {
    CacheService.getScriptCache().get(key);
}

function zeroPadding(numbner) {
    if (numbner < 10) {
        return "0" + numbner;
    }
    return numbner;
}

function getPhotoUrl(accessToken, userId) {
    let url = "https://";
    const userProfile = fetchWrapper(accessToken, `userProfiles/${userId}`);
    if ("photoUrl" in userProfile) {
        url += photoUrl.split("//")[1].replace("=mo", "");
        url += "=s72";
        return url
    } else {
        return null;
    }
}

function resetOAuth() {
    const service = getOAuthService(Session.getActiveUser().getEmail());
    service.reset();
}

// ##### ここから下はOAuth2関連の関数 #####


function getOAuthService(accountEmail) {
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
        .setScope('https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.announcements https://www.googleapis.com/auth/classroom.rosters.readonly https://www.googleapis.com/auth/classroom.profile.photos https://www.googleapis.com/auth/classroom.coursework.me https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly ')

        // Requests offline access.
        .setParam('access_type', 'offline')

        // Consent prompt is required to ensure a refresh token is always
        // returned when requesting offline access.
        .setParam('prompt', 'consent')

        .setCache(CacheService.getUserCache())
}

// OAuth2認証のコールバック関数
function authCallback(request) {
    var service = getOAuthService(Session.getActiveUser().getEmail());
    var isAuthorized = service.handleCallback(request);
    if (isAuthorized) {
        return HtmlService.createHtmlOutput('認証が完了しました。このウィンドウを閉じてください。');
    } else {
        return HtmlService.createHtmlOutput('認証に失敗しました。元の画面にもどり、再設定を行ってください。');
    }
}

// 認証を開始するための関数
function startOAuth2(email) {
    var service = getOAuthService(email);
    var authorizationUrl = service.getAuthorizationUrl(email);
    Logger.log('認証URL: ' + authorizationUrl);
    return authorizationUrl;
}