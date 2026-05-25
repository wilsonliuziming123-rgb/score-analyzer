const express = require("express");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_COOKIE_NAME = "scoreAnalyzerAuth";
const googleAuthStates = new Map();

app.set("trust proxy", 1);
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/me", function (req, res) {
    const user = getSignedInUser(req);

    return res.json({
        authenticated: Boolean(user),
        user: user,
        googleConfigured: isGoogleConfigured()
    });
});

app.get("/auth/google", function (req, res) {
    if (!isGoogleConfigured()) {
        return res.redirect("/?authError=google-not-configured");
    }

    const state = crypto.randomBytes(16).toString("hex");
    const redirectUri = getGoogleRedirectUri(req);

    googleAuthStates.set(state, Date.now());

    const params = new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: state,
        prompt: "select_account"
    });

    return res.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
});

app.get("/auth/google/callback", async function (req, res) {
    const code = req.query.code;
    const state = req.query.state;

    if (!code || !state || !googleAuthStates.has(state)) {
        return res.redirect("/?authError=google-state");
    }

    googleAuthStates.delete(state);

    try {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                code: code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: getGoogleRedirectUri(req),
                grant_type: "authorization_code"
            })
        });

        if (!tokenResponse.ok) {
            return res.redirect("/?authError=google-token");
        }

        const tokenData = await tokenResponse.json();
        const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: {
                Authorization: "Bearer " + tokenData.access_token
            }
        });

        if (!profileResponse.ok) {
            return res.redirect("/?authError=google-profile");
        }

        const profile = await profileResponse.json();

        setAuthCookie(res, {
            provider: "google",
            id: profile.sub,
            name: profile.name || profile.email,
            email: profile.email,
            picture: profile.picture
        });

        return res.redirect("/");
    } catch (error) {
        return res.redirect("/?authError=google-server");
    }
});

app.post("/auth/logout", function (req, res) {
    clearAuthCookie(res);

    return res.json({
        success: true
    });
});

app.post("/api/analyze-scores", function (req, res) {
    const scoresInput = req.body.scoresInput;

    // Stop early if the user submitted an empty textarea.
    if (!scoresInput || scoresInput.trim() === "") {
        return res.status(400).json({
            success: false,
            error: "Please enter at least one score."
        });
    }

    const scores = parseScores(scoresInput);

    if (scores.length === 0) {
        return res.status(400).json({
            success: false,
            error: "Please enter at least one valid score."
        });
    }

    if (!validateScores(scores)) {
        return res.status(400).json({
            success: false,
            error: "All scores must be valid numbers between 0 and 100."
        });
    }

    const statistics = calculateStatistics(scores);

    return res.json({
        success: true,
        data: statistics
    });
});

function parseScores(input) {
    // Replace English commas, Chinese commas, and new lines with spaces.
    return input
        .replace(/[,，]/g, " ")
        .replace(/\n/g, " ")
        .split(" ")
        .filter(function (item) {
            return item.trim() !== "";
        })
        .map(function (item) {
            return Number(item);
        });
}

function validateScores(scores) {
    for (let i = 0; i < scores.length; i++) {
        if (
            Number.isNaN(scores[i]) ||
            scores[i] < 0 ||
            scores[i] > 100
        ) {
            return false;
        }
    }

    return true;
}

function calculateStatistics(scores) {
    // Sorting first makes min, max, median, and quartiles easier to calculate.
    const sortedScores = [...scores].sort(function (a, b) {
        return a - b;
    });

    const count = sortedScores.length;
    const max = sortedScores[count - 1];
    const min = sortedScores[0];

    let sum = 0;
    let passingCount = 0;
    let failingCount = 0;

    for (let i = 0; i < sortedScores.length; i++) {
        sum = sum + sortedScores[i];

        if (sortedScores[i] >= 60) {
            passingCount++;
        } else {
            failingCount++;
        }
    }

    const mean = sum / count;
    const median = calculateMedian(sortedScores);
    const standardDeviation = calculateStandardDeviation(sortedScores, mean);

    const lowerHalf = getLowerHalf(sortedScores);
    const upperHalf = getUpperHalf(sortedScores);

    const q1 = count === 1 ? sortedScores[0] : calculateMedian(lowerHalf);
    const q3 = count === 1 ? sortedScores[0] : calculateMedian(upperHalf);
    const iqr = q3 - q1;
    const range = max - min;

    return {
        count: count,
        max: max,
        min: min,
        mean: roundToTwo(mean),
        standardDeviation: roundToTwo(standardDeviation),
        median: roundToTwo(median),
        q1: roundToTwo(q1),
        q3: roundToTwo(q3),
        iqr: roundToTwo(iqr),
        range: roundToTwo(range),
        passingCount: passingCount,
        failingCount: failingCount,
        sortedScores: sortedScores
    };
}

function calculateStandardDeviation(scores, mean) {
    let squaredDifferenceSum = 0;

    for (let i = 0; i < scores.length; i++) {
        squaredDifferenceSum += Math.pow(scores[i] - mean, 2);
    }

    return Math.sqrt(squaredDifferenceSum / scores.length);
}

function calculateMedian(arr) {
    if (arr.length === 0) {
        return 0;
    }

    const middle = Math.floor(arr.length / 2);

    if (arr.length % 2 === 1) {
        return arr[middle];
    } else {
        return (arr[middle - 1] + arr[middle]) / 2;
    }
}

function getLowerHalf(arr) {
    const middle = Math.floor(arr.length / 2);

    return arr.slice(0, middle);
}

function getUpperHalf(arr) {
    const middle = Math.floor(arr.length / 2);

    if (arr.length % 2 === 1) {
        return arr.slice(middle + 1);
    } else {
        return arr.slice(middle);
    }
}

function roundToTwo(num) {
    return Math.round(num * 100) / 100;
}

function isGoogleConfigured() {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function getGoogleRedirectUri(req) {
    return process.env.GOOGLE_CALLBACK_URL || getBaseUrl(req) + "/auth/google/callback";
}

function getBaseUrl(req) {
    return process.env.PUBLIC_BASE_URL || req.protocol + "://" + req.get("host");
}

function setAuthCookie(res, user) {
    const cookieValue = Buffer.from(JSON.stringify(user)).toString("base64url");
    const secureFlag = process.env.NODE_ENV === "production" || process.env.RENDER ? "; Secure" : "";

    res.setHeader(
        "Set-Cookie",
        AUTH_COOKIE_NAME + "=" + cookieValue + "; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax" + secureFlag
    );
}

function clearAuthCookie(res) {
    res.setHeader(
        "Set-Cookie",
        AUTH_COOKIE_NAME + "=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax"
    );
}

function getSignedInUser(req) {
    const cookies = parseCookies(req.headers.cookie || "");
    const cookieValue = cookies[AUTH_COOKIE_NAME];

    if (!cookieValue) {
        return null;
    }

    try {
        return JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8"));
    } catch (error) {
        return null;
    }
}

function parseCookies(cookieHeader) {
    const cookies = {};

    cookieHeader.split(";").forEach(function (cookie) {
        const parts = cookie.trim().split("=");
        const name = parts.shift();

        if (name) {
            cookies[name] = decodeURIComponent(parts.join("="));
        }
    });

    return cookies;
}

app.listen(PORT, function () {
    console.log("Server is running at http://localhost:" + PORT);
});
