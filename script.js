/**
 * Google Classroom Notification System
 * Google Apps Script (V8)
 */

/**
 * ユーザー設定用スプレッドシートを取得
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getUsersSheet() {
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!spreadsheetId) {
        throw new Error('スクリプトプロパティ SPREADSHEET_ID が設定されていません。プロジェクトの設定から設定してください。');
    }
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    const sheet = spreadsheet.getSheetByName('Sheet1') || spreadsheet.getSheets()[0];
    return sheet;
}

function isCacheEnabled() {
    return PropertiesService.getScriptProperties().getProperty('USE_CACHE') === 'True';
}

/**
 * Google Classroom API に GET リクエストを送る関数
 * 
 * @param {string} accessToken - Google OAuth2 アクセストークン
 * @param {string} url - APIのエンドポイントURL
 * @returns {object} - APIレスポンスデータ
 * @throws {Error} - リクエストが失敗した場合
 */
function fetchWrapper(accessToken, url) {
    const options = {
        method: "GET",
        headers: { 'Authorization': `Bearer ${accessToken}` },
        muteHttpExceptions: true
    };

    try {
        Logger.log(`[API Request] ${url}`);
        const response = UrlFetchApp.fetch(`https://classroom.googleapis.com/v1/${url}`, options);
        const responseCode = response.getResponseCode();
        if (responseCode >= 200 && responseCode < 300) {
            return JSON.parse(response.getContentText());
        } else {
            Logger.log(`[API Error] Status: ${responseCode}, Body: ${response.getContentText()}`);
            return {};
        }
    } catch (e) {
        Logger.log(`[Error] APIリクエスト失敗: ${url}, Error: ${e.message}`);
        throw new Error(`Failed to fetch: ${e}`);
    }
}

/**
 * メール送信テスト
 * @returns {boolean} - 送信成功なら true, 失敗なら false
 */
function testMail() {
    const userSetting = getActiveUserSetting();
    if (!userSetting || !userSetting.receiverEmail) return false;

    try {
        const email = userSetting.receiverEmail;
        MailApp.sendEmail(email, "【Classroom Summary Notification】テストメール送信", "メール送信テストです。");
        Logger.log(`[Mail Sent] テストメール送信成功: ${email}`);
        return true;
    } catch (e) {
        Logger.log(`[Error] メール送信失敗: ${e.message}`);
        return false;
    }
}

function sendVerificationMail(receiverEmail, token, expirationTime) {
    const subject = "【Classroom Summary Notification】メールアドレス確認";
    const template = HtmlService.createTemplateFromFile('verification_template');
    template.verificationUrl = `${getAppUrl()}?email=${encodeURIComponent(receiverEmail)}&token=${encodeURIComponent(token)}`;
    template.expirationTime = Utilities.formatDate(new Date(expirationTime), "Asia/Tokyo", "yyyy/MM/dd HH:mm");
    const htmlOutput = template.evaluate();
    htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    
    MailApp.sendEmail({
        to: receiverEmail,
        subject: subject,
        htmlBody: htmlOutput.getContent()
    });
}

/**
 * メールアドレス確認用のトークンを検証する関数
 *
 * @param {string} email
 * @param {string} token
 * @return {boolean} - トークンが正しければ true
 */
function verifyEmail(email, token) {
    if (!token || !email) return false;
    const now = new Date();
    const userSetting = getActiveUserSetting();
    if (!userSetting || userSetting.receiverEmail !== email || userSetting.token !== token) return false;
    const expiredTime = new Date(userSetting.expiredTime);
    if (isNaN(expiredTime.getTime()) || now.getTime() > expiredTime.getTime()) return false;

    const sheet = getUsersSheet();
    sheet.getRange(userSetting.id + 1, 5, 1, 3).setValues([[true, "", ""]]);
    return true;
}

/**
 * 全ユーザー設定をスプレッドシートから取得
 */
function getAllUserSettings() {
    const sheet = getUsersSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];
    
    const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    return data.map((row, index) => ({
        id: row[0] !== "" ? Number(row[0]) : index + 1,
        accountEmail: row[1],
        receiverEmail: row[2],
        time: row[3],
        isVerified: row[4] === true || String(row[4]).toLowerCase() === 'true',
        token: row[5],
        expiredTime: row[6]
    }));
}

/**
 * スプレッドシートから現在のアカウントのユーザー設定を取得
 * @returns {object | null} - ユーザー設定オブジェクト、または null
 */
function getActiveUserSetting() {
    const accountEmail = Session.getActiveUser().getEmail();
    if (!accountEmail) return null;
    return getAllUserSettings()
        .find(user => user.accountEmail === accountEmail) || null;
}

/**
 * スプレッドシートにユーザー設定を保存
 */
function createOrUpdateUser(receiverEmail, time) {
    const sheet = getUsersSheet();
    const userSetting = getActiveUserSetting();

    const expiredTime = new Date();
    expiredTime.setMinutes(expiredTime.getMinutes() + 10);
    const token = Utilities.getUuid();
    const accountEmail = Session.getActiveUser().getEmail();
    let shouldSendMail = false;

    if (userSetting) {
        const emailChanged = userSetting.receiverEmail !== receiverEmail;
        if (emailChanged || userSetting.isVerified === false) {
            sheet.getRange(userSetting.id + 1, 3, 1, 5).setValues([[receiverEmail, time, false, token, expiredTime]]);
            shouldSendMail = true;
        } else {
            sheet.getRange(userSetting.id + 1, 3, 1, 3).setValues([[receiverEmail, time, true]]);
        }
    } else {
        const newId = sheet.getLastRow(); // ヘッダーが1行目なら次行のIDは1
        sheet.appendRow([newId, accountEmail, receiverEmail, time, false, token, expiredTime]);
        shouldSendMail = true;
    }

    if (shouldSendMail) {
        try {
            sendVerificationMail(receiverEmail, token, expiredTime);
        } catch (e) {
            Logger.log(`[Error] メール送信失敗: ${e.message}`);
        }
    }

    Logger.log(`[User Settings Saved] { accountEmail: ${accountEmail}, receiverEmail: ${receiverEmail}, time: ${time} }`);
}

/**
 * HTMLエスケープ処理（XSS / メール内HTMLインジェクション防止）
 */
function escapeHtml(text) {
    if (text == null) return "";
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * URLエスケープ処理（危険なスキームを排除）
 */
function escapeUrl(url) {
    if (!url) return "#";
    const cleaned = String(url).trim();
    if (/^https?:\/\//i.test(cleaned)) {
        return escapeHtml(cleaned);
    }
    return "#";
}

/**
 * 文字列をエスケープして改行を `<br>` タグに変換
 */
function toBrTag(text) {
    return escapeHtml(text).replace(/\n/g, "<br>");
}

/**
 * 指定したDateが過去24時間以内か判定
 */
function isLatest(now, target) {
    return (now.getTime() - target.getTime()) < 1000 * 60 * 60 * 24;
}

/**
 * キャッシュのセット
 */
function setCache(key, value) {
    CacheService.getScriptCache().put(key, value, 300);
}

/**
 * キャッシュの取得
 */
function getCache(key) {
    return isCacheEnabled() ? CacheService.getScriptCache().get(key) : null;
}

/**
 * ゼロパディング
 */
function zeroPadding(number) {
    return number < 10 ? `0${number}` : number;
}

/**
 * WebアプリのURLを取得
 */
function getAppUrl() {
    return ScriptApp.getService().getUrl();
}

/**
 * GETリクエスト用関数
 */
function doGet(e) {
    e = e || { parameter: {} };
    if (e.parameter.email && e.parameter.token) {
        const email = e.parameter.email;
        const token = e.parameter.token;
        const result = verifyEmail(email, token);
        if (!result) {
            return HtmlService.createHtmlOutput("メールアドレスの確認に失敗しました。リンクの有効期限が切れているか、無効なトークンです。設定画面に戻り、再度お試しください。");
        }
    }

    const template = HtmlService.createTemplateFromFile("index");
    const accountEmail = Session.getActiveUser().getEmail();
    template.activeUserEmail = accountEmail;

    const service = getOAuthService(accountEmail);
    const userSetting = getActiveUserSetting();

    let doneStep = 0; // 0: 未認証, 1: 設定入力完了, 2: メールアドレス確認完了, 3: OAuth認証完了

    if (userSetting) {
        doneStep = userSetting.isVerified ? 2 : 1;
    }

    if (service && service.hasAccess() && userSetting) {
        doneStep = 3;
        const timeDate = new Date(userSetting.time);
        template.receiverEmail = userSetting.receiverEmail;
        if (!isNaN(timeDate.getTime())) {
            template.time = `${zeroPadding(timeDate.getHours())}:${zeroPadding(timeDate.getMinutes())}`;
        } else {
            template.time = String(userSetting.time || "");
        }
        template.isVerified = userSetting.isVerified;
        Logger.log(`ログイン中のユーザー設定 : { Email: ${template.receiverEmail}, Time: ${template.time}, isVerified: ${template.isVerified} }`);
    } else {
        template.receiverEmail = userSetting ? userSetting.receiverEmail : "";
        template.time = userSetting ? String(userSetting.time || "") : "";
        template.isVerified = userSetting ? userSetting.isVerified : false;
        Logger.log(`ログイン中のユーザー設定 : 未完了`);
    }

    template.doneStep = doneStep;

    const htmlOutput = template.evaluate();
    htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    htmlOutput.setTitle('Google Classroom™ メール通知送信システム');
    
    const faviconUrl = PropertiesService.getScriptProperties().getProperty('FAVICON_URL');
    if (faviconUrl) {
        htmlOutput.setFaviconUrl(faviconUrl);
    }
    return htmlOutput;
}

/**
 * スプレッドシートにemail,timeを保存する。テンプレート上から呼び出す。
 * @returns {string | null} - OAuth認証済みならnull, 未認証であれば認証URLを返す
 */
function saveUnverifiedUser(time, email) {
    createOrUpdateUser(email, time);
    const accountEmail = Session.getActiveUser().getEmail();
    Logger.log(`saved unverified user: { accountEmail: ${accountEmail}, receiverEmail: ${email}, time: ${time} }`);
    const service = getOAuthService(accountEmail);
    if (service && service.hasAccess()) {
        Logger.log('[OAuth] already authorized');
        return null;
    } else if (service) {
        Logger.log('[OAuth] start authorization');
        return service.getAuthorizationUrl(accountEmail);
    }
    return null;
}

/**
 * 現在時刻と指定時刻が一致していれば、メール通知を送信する関数（トリガー実行用）
 */
function triggerEveryMinute() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const allUserSettings = getAllUserSettings();

    allUserSettings.forEach(setting => {
        if (!setting.isVerified) return;
        const accountEmail = setting.accountEmail;
        const email = setting.receiverEmail;
        
        let targetHour = -1;
        let targetMinute = -1;
        
        if (setting.time instanceof Date) {
            targetHour = setting.time.getHours();
            targetMinute = setting.time.getMinutes();
        } else if (typeof setting.time === 'string' && setting.time.includes(':')) {
            const parts = setting.time.split(':');
            targetHour = parseInt(parts[0], 10);
            targetMinute = parseInt(parts[1], 10);
        }

        if (currentHour === targetHour && currentMinute === targetMinute) {
            sendReminder(accountEmail, email);
        }

        Logger.log(`Email: ${email}, Target: ${targetHour}:${targetMinute}, Current: ${currentHour}:${currentMinute}`);
    });
}

/**
 * メール通知を送信する関数
 */
function sendReminder(accountEmail, email) {
    const recipient = email;
    const subject = `【リマインダー】本日更新された GoogleClassroom のお知らせ`;
    const template = HtmlService.createTemplateFromFile('mail_template');
    const service = getOAuthService(accountEmail);
    if (service && service.hasAccess()) {
        const accessToken = service.getAccessToken();
        template.courses = getTodayUpdates(accessToken);
        template.hasAccess = true;
    } else {
        Logger.log("[OAuth] unauthorized. cannot get classroom updates.");
        template.courses = [];
        template.hasAccess = false;
    }

    const htmlOutput = template.evaluate();
    htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    const html = htmlOutput.getContent();

    MailApp.sendEmail(recipient, subject, html, { htmlBody: html });
}

/**
 * Google Classroom の更新情報を取得
 */
function getTodayUpdates(accessToken) {
    const now = new Date();
    let courses = [];
    const fetchedCourses = fetchWrapper(accessToken, "courses");
    if (!fetchedCourses || !fetchedCourses.courses) return courses;

    const chatIconUrl = PropertiesService.getScriptProperties().getProperty('CHAT_ICON_URL') 
        || "https://classroom-notification.s3.ap-northeast-1.amazonaws.com/chat_24dp_F3F3F3_FILL0_wght400_GRAD0_opsz24.png";

    for (const { id } of fetchedCourses.courses) {
        const cachedData = getCache(id);
        if (cachedData) {
            courses.push(JSON.parse(cachedData));
            continue;
        }

        const classroom = fetchWrapper(accessToken, `courses/${id}`);
        const announcementsRes = fetchWrapper(accessToken, `courses/${id}/announcements`);
        const courseWorkRes = fetchWrapper(accessToken, `courses/${id}/courseWork`);
        const courseWorkMaterialsRes = fetchWrapper(accessToken, `courses/${id}/courseWorkMaterials`);

        const posts = [
            ...(announcementsRes.announcements || []),
            ...(courseWorkRes.courseWork || []),
            ...(courseWorkMaterialsRes.courseWorkMaterial || [])
        ].filter(post => post.updateTime && isLatest(now, new Date(post.updateTime)))
            .map(post => {
                post["type"] = post.workType ? "WORKS" : post.topicId ? "WORK_MATERIALS" : "ANNOUNCEMENTS";
                
                const userId = post.creatorUserId;
                post["creatorUserPhotoTemplate"] = `<img class="materialIcon" src="${escapeUrl(chatIconUrl)}" alt="user_icon">`;
                try {
                    const userProfile = fetchWrapper(accessToken, `userProfiles/${userId}`);
                    post["creatorUserName"] = userProfile && userProfile.name ? escapeHtml(userProfile.name.fullName) : "教員";
                    if (userProfile && userProfile.photoUrl) {
                        const parts = userProfile.photoUrl.split("//");
                        if (parts[1]) {
                            const url = `https://${parts[1].replace("=mo", "")}=s72`;
                            post["creatorUserPhotoTemplate"] = `<img class="userIcon" src="${escapeUrl(url)}" alt="user_icon">`;
                        }
                    }
                    return post;
                } catch(e) {
                    Logger.log(`Cannot get userProfile. UserId : ${userId}. Error : ${e}`);
                    post["creatorUserName"] = "教員";
                    return post;
                }
            }
        );

        const courseData = {
            courseId: id,
            courseName: classroom.name || "名称未設定クラス",
            posts: posts
        };
        courses.push(courseData);
        setCache(id, JSON.stringify(courseData));
    }

    return courses;
}

// ##### ここから下はOAuth2関連の関数 #####

/**
 * OAuth2 認証サービスを取得
 */
function getOAuthService(accountEmail) {
    if (!accountEmail) return null;

    const clientId = PropertiesService.getScriptProperties().getProperty('CLIENT_ID');
    const clientSecret = PropertiesService.getScriptProperties().getProperty('CLIENT_SECRET');

    if (!clientId || !clientSecret) {
        Logger.log('[Warning] CLIENT_ID または CLIENT_SECRET がスクリプトプロパティに設定されていません。');
        return null;
    }

    return OAuth2.createService(`GoogleClassroom_${accountEmail}`)
        .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/auth')
        .setTokenUrl('https://accounts.google.com/o/oauth2/token')
        .setClientId(clientId)
        .setClientSecret(clientSecret)
        .setCallbackFunction('authCallback')
        .setPropertyStore(PropertiesService.getUserProperties())
        .setScope([
            'https://www.googleapis.com/auth/classroom.courses.readonly',
            'https://www.googleapis.com/auth/classroom.rosters.readonly',
            'https://www.googleapis.com/auth/classroom.profile.photos',
            'https://www.googleapis.com/auth/classroom.announcements.readonly',
            'https://www.googleapis.com/auth/classroom.coursework.me',
            'https://www.googleapis.com/auth/classroom.coursework.students.readonly',
            'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly'
        ].join(' '))
        .setParam('access_type', 'offline')
        .setParam('prompt', 'consent')
        .setCache(CacheService.getUserCache());
}

// OAuth2認証のコールバック関数
function authCallback(request) {
    const service = getOAuthService(Session.getActiveUser().getEmail());
    if (!service) {
        return HtmlService.createHtmlOutput('認証設定にエラーが発生しました。管理者に連絡してください。');
    }
    const isAuthorized = service.handleCallback(request);
    if (isAuthorized) {
        return HtmlService.createHtmlOutput('認証が完了しました。このウィンドウを閉じてください。');
    } else {
        return HtmlService.createHtmlOutput('認証に失敗しました。元の画面にもどり、再設定を行ってください。');
    }
}

// 認証を開始するための関数
function startOAuth2(email) {
    const service = getOAuthService(email);
    if (!service) return null;
    const authorizationUrl = service.getAuthorizationUrl(email);
    Logger.log('認証URL: ' + authorizationUrl);
    return authorizationUrl;
}

function resetOAuth() {
    const service = getOAuthService(Session.getActiveUser().getEmail());
    if (service) {
        service.reset();
    }
}

// ##### Use only in templates #####

// <li>タグ内に添付ファイル情報を出力
function getMaterialTemplate(material) {
    let url = "#";
    let title = "";
    if ("driveFile" in material && material.driveFile && material.driveFile.driveFile) {
        url = material.driveFile.driveFile.alternateLink || "#";
        title = material.driveFile.driveFile.title || "ドライブ添付ファイル";
    } else if ("youtubeVideo" in material && material.youtubeVideo) {
        url = material.youtubeVideo.alternateLink || "#";
        title = material.youtubeVideo.title || "YouTube動画";
    } else if ("link" in material && material.link) {
        url = material.link.url || "#";
        title = material.link.title || material.link.url || "添付リンク";
    } else if ("form" in material && material.form) {
        url = material.form.formUrl || "#";
        title = material.form.title || "Googleフォーム";
    }
    return `<li><a href="${escapeUrl(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a></li>`;
}