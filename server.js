const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

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

app.listen(PORT, function () {
    console.log("Server is running at http://localhost:" + PORT);
});
