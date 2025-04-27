const now = new Date();
now.setDate(now.getDate());
const tomorrow = new Date();
tomorrow.setDate(now.getDate() + 1);

const USERS_SHEET = SpreadsheetApp.openById('1ii2MBtSLK5vmq9PNP6y0RBtvQsxwefstCfQ_HNoIFyI').getSheetByName('Sheet1');

const USE_CACHE = PropertiesService.getScriptProperties().getProperty('USE_CACHE') === 'True';

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
        headers: { 'Authorization': `Bearer ${accessToken}` }
    };

    try {
        Logger.log(`[API Request] ${url}`);
        const response = UrlFetchApp.fetch(`https://classroom.googleapis.com/v1/${url}`, options);
        return JSON.parse(response.getContentText());
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
    const values = getActiveUserSetting();
    if (!values) return false;

    try {
        const email = values[1];
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
    template.verificationUrl = `${getAppUrl()}?email=${receiverEmail}&token=${token}`;
    template.expirationTime = expirationTime;
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
 * @return {string} - トークンが正しければ "OK" を返す。トークンが無効な場合はエラー内容を返す。
 */
function verifyEmail(email, token) {
    const userSetting = getActiveUserSetting();
    if (!userSetting || userSetting.receiverEmail !== email || userSetting.token !== token) return false;
    const expiredTime = new Date(userSetting.expiredTime);
    if (now.getTime() > expiredTime.getTime()) return false;
    USERS_SHEET.getRange(userSetting.id + 1, 5, 1, 3).setValues([[true, "", ""]]);
    return true;
}

function getAllUserSettings() {
    const data = USERS_SHEET.getRange(2, 1, USERS_SHEET.getLastRow() - 1, USERS_SHEET.getLastColumn()).getValues();
    return data.map(row => ({
        id: row[0],
        accountEmail: row[1],
        receiverEmail: row[2],
        time: row[3],
        isVerified: row[4],
        token: row[5]
    }));
}

/**
 * スプレッドシートからユーザー設定を取得
 * @returns {object | null} - ユーザー設定オブジェクト、または null
 */
function getActiveUserSetting() {
    const accountEmail = Session.getActiveUser().getEmail();
    return getAllUserSettings()
        .find(user => user.accountEmail === accountEmail) || null;
}

/**
 * スプレッドシートにユーザー設定を保存
 */
function createOrUpdateUser(receiverEmail, time) {
    const userSetting = getActiveUserSetting();

    const expiredTime = new Date();
    expiredTime.setMinutes(expiredTime.getMinutes() + 10);
    const token = Utilities.getUuid();
    const accountEmail = Session.getActiveUser().getEmail();
    let shouldSendMail = false;

    if (userSetting) {
        const emailChanged = userSetting.receiverEmail !== receiverEmail;
        if (emailChanged || userSetting.isVerified === false) {
            USERS_SHEET.getRange(userSetting.id + 1, 3, 1, 5).setValues([[receiverEmail, time, false, token, expiredTime]]);
            shouldSendMail = true;
        } else {
            USERS_SHEET.getRange(userSetting.id + 1, 3, 1, 3).setValues([[receiverEmail, time, true]]);
        }
    } else {
        USERS_SHEET.appendRow([USERS_SHEET.getLastRow() - 1, accountEmail, receiverEmail, time, false, token, expiredTime]);
        shouldSendMail = true;
    }

    if (shouldSendMail) {
        try {
            sendVerificationMail(receiverEmail, token, expiredTime);
        } catch (e) {
            // TODO: 送信失敗時の処理
            Logger.log(`[Error] メール送信失敗: ${e.message}`);
        }
    }

    Logger.log(`[User Settings Saved] { userId: ${USERS_SHEET.getLastRow() - 1}, accountEmail: ${accountEmail}, receiverEmail: ${receiverEmail}, time: ${time} }`);
}

/**
 * 文字列の改行を `<br>` タグに変換
 */
function toBrTag(text) {
    return text.replace(/\n/g, "<br>");
}

/**
 * 指定したDateが過去24時間以内か判定
 */
function isLatest(today, target) {
    return (today.getTime() - target.getTime()) < 1000 * 60 * 60 * 24;
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
    return USE_CACHE ? CacheService.getScriptCache().get(key) : null;
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
    if (e.parameter.email && e.parameter.token) {
        const email = e.parameter.email;
        const token = e.parameter.token;
        const result = verifyEmail(email, token);
        if (!result) {
            return HtmlService.createHtmlOutput("メールアドレスの確認に失敗しました。設定画面に戻り、再度お試しください。");
        }
    }

    const template = HtmlService.createTemplateFromFile("index");
    const accountEmail = Session.getActiveUser().getEmail();
    template.activeUserEmail = accountEmail;

    const service = getOAuthService(accountEmail);
    const userSetting = getActiveUserSetting();

    let doneStep = 0; // 0: 未認証, 1: 設定入力完了, 2: メーアドレス確認完了, 3: OAuth認証完了

    if (userSetting) {
        doneStep = userSetting.isVerified ? 2 : 1;
    }

    if (service.hasAccess() && userSetting) {
        doneStep = 3;
        const timeDate = new Date(userSetting.time);
        template.receiverEmail = userSetting.receiverEmail;
        template.time = `${zeroPadding(timeDate.getHours())}:${zeroPadding(timeDate.getMinutes())}`;
        template.isVerified = userSetting.isVerified;
        Logger.log(`ログイン中のユーザー設定 : { Email: ${template.receiverEmail}, Time: ${template.time}, isVerified: ${template.isVerified} }`);
    } else {
        template.receiverEmail = "";
        template.time = "";
        template.isVerified = false;
        Logger.log(`ログイン中のユーザー設定 : 未設定`);
    }

    template.doneStep = doneStep;

    const htmlOutput = template.evaluate();
    htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    htmlOutput.setTitle('Google Classroom™ メール通知送信システム');
    htmlOutput.setFaviconUrl('https://drive.google.com/uc?id=1YhNuGieqF_rUP02Tdo95uaB8w3pG_USf&.png');
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
    if (service.hasAccess()) {
        Logger.log('[OAuth] already authorized');
        return null;
    } else {
        Logger.log('[OAuth] start authorization');
        return service.getAuthorizationUrl(accountEmail);
    }
}

/**
 * 現在時刻と指定時刻が一致していれば、メール通知を送信する関数
 */
function triggerEveryMinute() {
    const allUserSettings = getAllUserSettings();

    allUserSettings.forEach(setting => {
        const accountEmail = setting.accountEmail;
        const email = setting.receiverEmail;
        const rawTime = new Date(setting.time);
        const time = new Date(now.getFullYear(), now.getMonth(), now.getDate(), rawTime.getHours(), rawTime.getMinutes());

        if (now.getHours() == time.getHours() && now.getMinutes() == time.getMinutes()) {
            sendReminder(accountEmail, email);
        }

        Logger.log(`Email: ${email}, Time: ${time}`);
    });
}

/**
 * メール通知を送信する関数
 */
function sendReminder(accountEmail, email) {
    const recipient = email; // 送信先メールアドレス
    const subject = `【リマインダー】本日更新された GoogleClassroom のお知らせ`;
    const template = HtmlService.createTemplateFromFile('mail_template');
    const service = getOAuthService(accountEmail);
    if (service.hasAccess()) {
        const accessToken = service.getAccessToken();
        template.courses = getTodayUpdates(accessToken);
        template.hasAccess = true;
    } else {
        Logger.log("[OAuth] unauthorized. cannot get classroom updates.");
        template.courses = [];
        template.hasAccess = false;
        // ここで再認証を行うURLをテンプレートに渡して再認証させる
        // そもそものGoogle認証も、テストメールに含ませた方が理想的？
    }

    const htmlOutput = template.evaluate();
    htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
    const html = htmlOutput.getContent();

    // メール送信
    MailApp.sendEmail(recipient, subject, html, { htmlBody: html });
}

/**
 * Google Classroom の更新情報を取得
 */
function getTodayUpdates(accessToken) {
    let courses = [];
    const fetchedCourses = fetchWrapper(accessToken, "courses");

    for (const { id } of fetchedCourses.courses) {
        const cachedData = getCache(id);
        if (cachedData) {
            courses.push(JSON.parse(cachedData));
            continue;
        }

        const classroom = fetchWrapper(accessToken, `courses/${id}`);
        const posts = [
            ...fetchWrapper(accessToken, `courses/${id}/announcements`).announcements || [],
            ...fetchWrapper(accessToken, `courses/${id}/courseWork`).courseWork || [],
            ...fetchWrapper(accessToken, `courses/${id}/courseWorkMaterials`).courseWorkMaterial || []
        ].filter(post => isLatest(now, new Date(post.updateTime)))
            .map(post => {
                post["type"] = post.workType ? "WORKS" : post.topicId ? "WORK_MATERIALS" : "ANNOUNCEMENTS";
                
                const userId = post.creatorUserId;
                const chatIconUrl = "https://classroom-notification.s3.ap-northeast-1.amazonaws.com/chat_24dp_F3F3F3_FILL0_wght400_GRAD0_opsz24.png";
                post["creatorUserPhotoTemplate"] = `<img class="materialIcon" src="${chatIconUrl}" alt="user_icon">`;
                let userProfile;
                try {
                    userProfile = fetchWrapper(accessToken, `userProfiles/${userId}`);
                    post["creatorUserName"] = userProfile.name.fullName;
                    if (userProfile.photoUrl) {
                        const url = `https://${userProfile.photoUrl.split("//")[1].replace("=mo", "")}=s72`;
                        post["creatorUserPhotoTemplate"] = `<img class="userIcon" src="${url}" alt="user_icon">`;
                    }
                    return post
                } catch(e) {
                    Logger.log(`Cannot get userProfile. UserId : ${userId}. Error : ${e}`);
                    post["creatorUserName"] = "ユーザー名不明";
                    return post;
                }
            }
        );

        const courseData = {
            courseId: id,
            courseName: classroom.name,
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

    return OAuth2.createService(`GoogleClassroom_${accountEmail}`)
        .setAuthorizationBaseUrl('https://accounts.google.com/o/oauth2/auth')
        .setTokenUrl('https://accounts.google.com/o/oauth2/token')
        .setClientId(PropertiesService.getScriptProperties().getProperty('CLIENT_ID'))
        .setClientSecret(PropertiesService.getScriptProperties().getProperty('CLIENT_SECRET'))
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
    const authorizationUrl = service.getAuthorizationUrl(email);
    Logger.log('認証URL: ' + authorizationUrl);
    return authorizationUrl;
}

function resetOAuth() {
    const service = getOAuthService(Session.getActiveUser().getEmail());
    service.reset();
}

// ##### Use only in templates #####

// <li>タグ内に添付ファイル情報を出力
function getMaterialTemplate(material) {
    let url, title;
    if ("driveFile" in material) {
        url = material.driveFile.driveFile.alternateLink;
        title = material.driveFile.driveFile.title;
    } else if ("youtubeVideo" in material) {
        url = material.youtubeVideo.alternateLink;
        title = material.youtubeVideo.title;
    } else if ("link" in material) {
        url = material.link.url;
        title = material.link.title;
    } else if ("form" in material) {
        url = material.form.formUrl;
        title = material.form.title;
    }
    return `<li><a href="${url}" target="_blank">${title}</a></li>`;
}