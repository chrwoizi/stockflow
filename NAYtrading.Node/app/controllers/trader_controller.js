var exports = module.exports = {}
var model = require('../models/index');
var sql = require('../sql/sql');
var config = require('../config/envconfig');
var dateFormat = require('dateformat');

exports.getOpenSuggestions = async function (req, res) {
    try {
        if (req.isAuthenticated()) {

            var oldestSuggestionTime = new Date(new Date().getTime() - config.trader_max_suggestion_age_seconds * 1000);

            var suggestions = await sql.query("SELECT s.ID, u.Decision AS Action, i.InstrumentName, i.Isin, i.Wkn, s.Price FROM snapshots s \
                INNER JOIN usersnapshots u ON u.Snapshot_ID = s.ID \
                INNER JOIN instruments i ON i.ID = s.Instrument_ID \
                WHERE u.User = @user AND (u.Decision = 'buy' OR u.Decision = 'sell') \
                AND (u.Decision = 'sell' OR s.Time >= @oldestSuggestionTime) \
                AND NOT EXISTS (SELECT 1 FROM tradelogs l WHERE l.Snapshot_ID = s.ID AND l.Status = 'Complete') \
                AND (u.Decision = 'sell' OR (SELECT COUNT(1) FROM tradelogs l WHERE l.Snapshot_ID = s.ID) < @maxRetryCount) \
                AND (NOT EXISTS (SELECT 1 FROM tradelogs l WHERE l.Snapshot_ID = s.ID) \
                    OR (SELECT l.Status FROM tradelogs l WHERE l.Snapshot_ID = s.ID ORDER BY l.Time DESC LIMIT 1) IN ('Initial', 'TemporaryError')) \
                ORDER BY s.Time DESC", {
                    "@user": req.user.email,
                    "@oldestSuggestionTime": oldestSuggestionTime,
                    "@maxRetryCount": config.trader_max_retry_count
                });

            var viewModels = suggestions;
            res.json(viewModels);

        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        res.status(500);
        res.json({ error: error.message });
    }
};

exports.hasNewerSuggestion = async function (req, res) {
    try {
        if (req.isAuthenticated()) {

            var suggestions = await sql.query("SELECT s.Instrument_ID, s.Time FROM snapshots s \
                INNER JOIN usersnapshots u ON s.ID = u.Snapshot_ID \
                WHERE u.User = @user AND s.ID = @id", {
                    "@user": req.user.email,
                    "@id": req.params.id
                });

            if (suggestions && suggestions.length) {
                var suggestion = suggestions[0];

                var newerSuggestions = await sql.query("SELECT count(1) AS c FROM snapshots s \
                    INNER JOIN usersnapshots u ON s.ID = u.Snapshot_ID \
                    WHERE s.Instrument_ID = @instrumentId \
                    AND s.Time > @time AND s.ID <> @id \
                    AND u.User = @user AND (u.Decision = 'buy' OR u.Decision = 'sell')", {
                        "@instrumentId": suggestion.Instrument_ID,
                        "@time": suggestion.Time,
                        "@id": req.params.id,
                        "@user": req.user.email
                    });

                var viewModel = {};
                viewModel.hasNewerSuggestion = (newerSuggestions && newerSuggestions.length && newerSuggestions[0].c) ? true : false;

                res.json(viewModel);
            }
            else {
                res.status(404);
                res.json({ message: "not found" });
            }
        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        res.status(500);
        res.json({ error: error.message });
    }
};

exports.saveTradeLog = async function (req, res) {
    try {
        if (req.isAuthenticated()) {

            var log = req.body;

            var suggestions = await sql.query("SELECT s.ID FROM snapshots s \
                INNER JOIN usersnapshots u ON u.Snapshot_ID = s.ID \
                WHERE u.User = @user AND s.ID = @id", {
                    "@user": req.user.email,
                    "@id": log.Snapshot_ID
                });

            if (suggestions && suggestions.length) {

                if (log.ID >= 0) {
                    await model.tradelog.update({
                        Snapshot_ID: log.Snapshot_ID,
                        Time: log.Time,
                        Quantity: log.Quantity,
                        Price: log.Price,
                        Status: log.Status,
                        Message: log.Message,
                        User: req.user.email
                    }, {
                            where: {
                                ID: log.ID
                            }
                        });

                    var viewModel = {
                        ID: log.ID
                    };
                    res.json(viewModel);
                }
                else {
                    var newLog = await model.tradelog.create({
                        Snapshot_ID: log.Snapshot_ID,
                        Time: log.Time,
                        Quantity: log.Quantity,
                        Price: log.Price,
                        Status: log.Status,
                        Message: log.Message,
                        User: req.user.email
                    });

                    var viewModel = {
                        ID: newLog.ID
                    };
                    res.json(viewModel);
                }
            }
            else {
                res.status(404);
                res.json({ message: "not found" });
            }
        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        res.status(500);
        res.json({ error: error.message });
        console.log(error.message + "\n" + error.stack);
    }
};

exports.getSuggestions = async function (req, res) {

    try {
        if (req.isAuthenticated()) {

            var rows = await sql.query("SELECT s.ID, s.Time, i.InstrumentName, u.Decision AS Action, s.Price, \
                (SELECT l.Status FROM tradelogs AS l WHERE l.Snapshot_ID = s.ID ORDER BY l.Time DESC LIMIT 1) AS Status \
                FROM snapshots s \
                INNER JOIN usersnapshots u ON s.ID = u.Snapshot_ID \
                INNER JOIN instruments i ON i.ID = s.Instrument_ID \
                WHERE u.User = @user AND (u.Decision = 'buy' OR u.Decision = 'sell')", {
                    "@user": req.user.email
                });

            var result = rows.map(item => {
                return {
                    id: item.ID,
                    T: dateFormat(item.Time, 'dd.mm.yy'),
                    TS: dateFormat(item.Time, 'yymmdd'),
                    I: item.InstrumentName,
                    A: item.Action,
                    P: item.Price,
                    S: (function (status) {
                        switch (status) {
                            case 'Processing': return 'p';
                            case 'TemporaryError': return 't';
                            case 'FatalError': return 'f';
                            case 'Complete': return 'c';
                            default: return 'i';
                        }
                    })(item.Status)
                }
            });

            res.status(200);
            res.json(result);
        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        res.status(500);
        res.json({ error: error.message });
    }
};

exports.getSuggestion = async function (req, res) {

    try {
        if (req.isAuthenticated()) {

            var rows = await sql.query("SELECT s.ID, s.Time, i.InstrumentName, i.Isin, i.Wkn, u.Decision AS Action, s.Price, \
                (SELECT l.Status FROM tradelogs AS l WHERE l.Snapshot_ID = s.ID ORDER BY l.Time DESC LIMIT 1) AS Status \
                FROM snapshots s \
                INNER JOIN usersnapshots u ON s.ID = u.Snapshot_ID \
                INNER JOIN instruments i ON i.ID = s.Instrument_ID \
                WHERE s.ID = @id AND u.User = @user", {
                    "@user": req.user.email,
                    "@id": req.params.id
                });
            if (rows && rows.length) {
                var suggestion = rows[0];

                var logs = await model.tradelog.findAll({
                    where: {
                        Snapshot_ID: suggestion.ID,
                        User: req.user.email
                    }
                });

                suggestion.logs = logs.map(x => x.get({ plain: true }));

                var t = dateFormat(suggestion.Time, 'dd.mm.yy');
                suggestion.Time = t;

                res.status(200);
                res.json(suggestion);
            }
            else {
                res.status(404);
                res.json({ error: "not found" });
            }
        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        res.status(500);
        res.json({ error: error.message });
    }
};