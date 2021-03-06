const model = require('../models/index');
const sql = require('../sql/sql');
const dateFormat = require('dateformat');
const fs = require('fs');
const ratesProvider = require('../providers/rates_provider');
const portfoliosJob = require('../jobs/portfolios.js');
const config = require('../config/envconfig.js');
const path = require('path');
const { parseDate } = require('../tools');

let stats_sql = "";
try {
    stats_sql = fs.readFileSync(__dirname + '/../sql/stats.sql', 'utf8');
} catch (e) {
    console.log('Error:', e.stack);
}

let open_trade_values_sql = "";
try {
    open_trade_values_sql = fs.readFileSync(__dirname + '/../sql/open_trade_values.sql', 'utf8');
} catch (e) {
    console.log('Error:', e.stack);
}

let next_sell_trade_sql = "";
try {
    next_sell_trade_sql = fs.readFileSync(__dirname + '/../sql/next_sell_trade.sql', 'utf8');
} catch (e) {
    console.log('Error:', e.stack);
}


function return500(res, e) {
    res.status(500);
    res.json({ error: e.message });
}

function getStatsViewModel(model) {
    function getSaleViewModel(model) {
        return {
            D: dateFormat(model.Time, 'dd.mm.yy'),
            DS: dateFormat(model.Time, 'yymmdd'),
            S: model.IsComplete == 1 ? 'c' : 'o',
            R: (Math.floor(model.Return * 10000)) / 10000.0,
            I: model.InstrumentName,
            II: model.InstrumentId,
            C: model.Confirmed
        };
    }

    let valueHistory = [];
    if (model.portfolios && model.portfolios.length > 0) {

        const history = model.portfolios.map(x => {
            return {
                Time: new Date(x.Time),
                Return: (x.Value - x.Deposit) / x.Deposit
            };
        });

        const day = 24 * 60 * 60 * 1000;
        let previousItem = history[0];
        const dailyHistory = [];

        for (let i = 0; i < history.length; ++i) {
            const item = history[i];
            let previousTime = previousItem.Time;
            while (item.Time.getTime() - previousTime.getTime() >= 1.5 * day) {
                previousTime = new Date(previousTime.getTime() + day);
                dailyHistory.push({
                    Time: previousTime,
                    Return: previousItem.Return
                });
            }
            dailyHistory.push(item);
            previousItem = item;
        }

        valueHistory = dailyHistory.map(x => {
            return {
                Time: dateFormat(x.Time, 'dd.mm.yyyy'),
                Return: x.Return
            };
        });
    }

    return {
        Value: model.portfolio ? model.portfolio.Value : 0,
        Deposit: model.portfolio ? model.portfolio.Deposit : 0,
        ValueHistory: valueHistory,
        OpenCount: model.portfolio ? model.portfolio.OpenCount : 0,
        CompleteCount: model.portfolio ? model.portfolio.CompleteCount : 0,
        Sales: model.Sales.map(getSaleViewModel)
    };
}

async function getStatsForUser(user) {
    const stats = {};
    stats.Sales = [];

    stats.portfolios = await model.portfolio.findAll({
        where: {
            User: user
        },
        order: [["Time", "ASC"]]
    });

    if (stats.portfolios && stats.portfolios.length > 0) {
        stats.portfolio = stats.portfolios[stats.portfolios.length - 1];
    }

    const trades = await sql.query(stats_sql, {
        "@userName": user
    });

    const openTradeValues = await sql.query(open_trade_values_sql, {
        "@userName": user
    });

    let openCount = 0;
    let completeCount = 0;

    const buyTrades = {};
    for (let i = 0; i < trades.length; ++i) {
        const trade = trades[i];

        if (trade.Decision == "buy") {

            const open = openTradeValues.filter(x => x.ID == trade.ID);
            if (open.length == 1) {
                stats.Sales.push({
                    Time: open[0].LatestSnapshotTime,
                    IsComplete: false,
                    Return: (open[0].LatestPrice - trade.Price) / trade.Price,
                    InstrumentName: trade.InstrumentName,
                    InstrumentId: trade.InstrumentId,
                    Confirmed: trade.Confirmed
                });
                openCount++;
            }
            else {
                buyTrades[trade.InstrumentId] = trade;
            }
        }
        else if (trade.Decision == "sell") {

            const buyTrade = buyTrades[trade.InstrumentId];
            if (typeof (buyTrade) === 'undefined') {
                throw new Error("could not find buy trade for user " + user + " and instrument " + trade.InstrumentId);
            }

            delete buyTrades[trade.InstrumentId];

            stats.Sales.push({
                Time: trade.Time,
                IsComplete: true,
                Return: (trade.Price - buyTrade.Price) / buyTrade.Price,
                InstrumentName: trade.InstrumentName,
                Confirmed: buyTrade.Confirmed
            });
            completeCount++;
        }
    }

    const missing = Object.keys(buyTrades);
    for (let i = 0; i < missing.length; ++i) {
        const buyTrade = buyTrades[missing[i]];
        const sellTrades = await sql.query(next_sell_trade_sql, {
            "@userName": user,
            "@instrumentId": buyTrade.InstrumentId,
            "@fromTime": buyTrade.Time,
        });
        if (sellTrades.length == 0) {
            throw new Error("could not determine sell price for buy trade " + buyTrade.ID);
        }
        else {
            const sellTrade = sellTrades[0];
            stats.Sales.push({
                Time: sellTrade.Time,
                IsComplete: true,
                Return: (sellTrade.Price - buyTrade.Price) / buyTrade.Price,
                InstrumentName: buyTrade.InstrumentName
            });
            completeCount++;
        }
    }

    stats.openCount = openCount;
    stats.completeCount = completeCount;

    return stats;
}

function getErrors(stats) {

    let errors = "";

    if (stats.portfolio) {

        if (stats.openCount != stats.portfolio.OpenCount) {
            errors = "Open trade count mismatch: expected " + stats.portfolio.OpenCount + ", actual " + stats.openCount + ".";
        }

        if (stats.completeCount != stats.portfolio.CompleteCount) {
            if (errors.length > 0) {
                errors += " ";
            }
            errors += "Complete trade count mismatch: expected " + stats.portfolio.CompleteCount + ", actual " + stats.completeCount + ".";
        }
    }

    return errors;
}

exports.getStats = async function (req, res) {
    try {
        if (req.isAuthenticated()) {

            let users = [req.user.email];

            let otherUser = null;
            if (req.user.email.endsWith(".ai")) {
                otherUser = req.user.email.substr(0, req.user.email.length - 3);
            }
            else {
                otherUser = req.user.email + ".ai";
            }

            const count = await sql.query("SELECT COUNT(1) as c FROM users WHERE email = @user", {
                "@user": otherUser
            });

            if (count[0].c > 0) {
                users.push(otherUser);
            }

            if (req.user.email == config.admin_user) {
                const all_users = await sql.query("SELECT email FROM users order by email");
                users = users.concat(all_users.filter(x => users.indexOf(x.email) == -1).map(x => x.email));
            }

            const user = req.params.user || req.user.email;

            if (users.indexOf(user) != -1) {
                const stats = await getStatsForUser(user);

                const errors = getErrors(stats);

                if (errors.length > 0) {
                    console.log("Error in stats for user " + req.user.email + ": " + errors);
                }

                const viewModel = getStatsViewModel(stats);

                viewModel.Users = users;

                res.json({ stats: viewModel });
            }
            else {
                res.status(401);
                res.json({ error: "unauthorized" });
            }
        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        if (portfoliosJob.updatingUser != req.user.email) {
            await sql.query("DELETE FROM trades WHERE User = @user", {
                "@user": req.user.email
            });

            await sql.query("DELETE FROM portfolios WHERE User = @user", {
                "@user": req.user.email
            });
        }

        return500(res, error);
    }
};

exports.clearDecisions = async function (req, res) {
    try {
        if (req.isAuthenticated()) {
            if (req.user.email.endsWith('.ai')) {

                await model.usersnapshot.destroy({
                    where: {
                        User: req.user.email
                    }
                });

                await model.portfolio.destroy({
                    where: {
                        User: req.user.email
                    }
                });

                res.json({ status: "ok" });
            }
            else {
                res.status(404);
                res.json({ error: "action not applicable" });
            }

        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        return500(res, error);
    }
};

exports.clearStats = async function (req, res) {
    try {
        if (req.isAuthenticated() && req.user.email == config.admin_user) {

            await sql.query("DELETE FROM trades");
            await sql.query("DELETE FROM portfolios");

            res.json({ status: "ok" });
        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        return500(res, error);
    }
};

exports.reloadConfig = async function (req, res) {

    try {
        if (req.isAuthenticated() && req.user.email == config.admin_user) {

            config.reload();

            res.status(200);
            res.json({});
        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        return500(res, error);
    }
};

exports.monitor = async function (req, res) {
    try {
        if (req.isAuthenticated() && req.user.email == config.admin_user) {

            const monitors = await sql.query("select `key`, `value`, createdAt from monitors");

            const result = {};
            for (const monitor of monitors) {
                if (monitor.createdAt) {
                    const date = dateFormat(parseDate(monitor.createdAt), "yymmdd");
                    if (!result[date]) {
                        result[date] = {};
                    }
                    result[date][monitor.key] = JSON.parse(monitor.value);
                }
            }

            const list = [];
            for (const date of Object.getOwnPropertyNames(result)) {
                const day = result[date];
                day.T = date;
                list.push(day);
                for (const key of Object.getOwnPropertyNames(day)) {
                    const item = day[key];
                    item.sum = 0;
                    if (item.sources) {
                        for (const sourceType of Object.getOwnPropertyNames(item.sources)) {
                            const source = item.sources[sourceType];
                            if (typeof (source) === 'number') {
                                item.sum += source;
                            }
                            else if (source.markets) {
                                source.sum = 0;
                                for (const marketId of Object.getOwnPropertyNames(source.markets)) {
                                    const market = source.markets[marketId];
                                    item.sum += market;
                                    source.sum += market;
                                }
                            }
                        }
                    }
                }
            }

            list.sort((a, b) => a.T - b.T);

            res.json({ days: list });
        }
        else {
            res.status(401);
            res.json({ error: "unauthorized" });
        }
    }
    catch (error) {
        return500(res, error);
    }
};

exports.getProviders = async function (req, res) {
    try {
        if (req.isAuthenticated() && req.user.email == config.admin_user) {
            const sources = ratesProvider.sources.map(function (x) { return { source: x } });
            let markets = [];
            for (let i = 0; i < ratesProvider.sources.length; ++i) {
                markets = ratesProvider.providers[ratesProvider.sources[i]].markets.map(function (x) { return { market: x } });
                markets = markets.concat(markets);
            }
            res.json({ markets: markets, sources: sources });
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

function formatTime(obj) {
    const str = obj.time;
    const date = new Date(str.substr(0, 4), parseInt(str.substr(4, 2)) - 1, str.substr(6, 2), str.substr(8, 2), parseInt(str.substr(10, 2)), str.substr(12, 2));
    obj.timeStr = dateFormat(date, 'dd.mm.yyyy HH:mm:ss');
}

function formatTrainDataRatio(obj) {
    obj.dataRatioPercent = ((1 - obj.test_data_ratio) * 100).toFixed(2);
}

function formatTestDataRatio(obj) {
    obj.dataRatioPercent = (obj.test_data_ratio * 100).toFixed(2);
}

exports.getProcessings = function (req, res) {
    try {
        if (req.isAuthenticated()) {

            const result = {};

            let filePath = path.resolve(config.processing_dir + "/" + req.user.email + "/buying_train_norm.csv");
            if (fs.existsSync(filePath) && fs.existsSync(filePath + ".meta")) {
                result.buyingTrain = JSON.parse(fs.readFileSync(filePath + ".meta", 'utf8'));
                formatTime(result.buyingTrain);
                formatTrainDataRatio(result.buyingTrain);
            }
            else {
                result.buyingTrain = null;
            }

            filePath = path.resolve(config.processing_dir + "/" + req.user.email + "/buying_test_norm.csv");
            if (fs.existsSync(filePath) && fs.existsSync(filePath + ".meta")) {
                result.buyingTest = JSON.parse(fs.readFileSync(filePath + ".meta", 'utf8'));
                formatTime(result.buyingTest);
                formatTestDataRatio(result.buyingTest);
            }
            else {
                result.buyingTest = null;
            }

            filePath = path.resolve(config.processing_dir + "/" + req.user.email + "/selling_train_norm.csv");
            if (fs.existsSync(filePath) && fs.existsSync(filePath + ".meta")) {
                result.sellingTrain = JSON.parse(fs.readFileSync(filePath + ".meta", 'utf8'));
                formatTime(result.sellingTrain);
                formatTrainDataRatio(result.sellingTrain);
            }
            else {
                result.sellingTrain = null;
            }

            filePath = path.resolve(config.processing_dir + "/" + req.user.email + "/selling_test_norm.csv");
            if (fs.existsSync(filePath) && fs.existsSync(filePath + ".meta")) {
                result.sellingTest = JSON.parse(fs.readFileSync(filePath + ".meta", 'utf8'));
                formatTime(result.sellingTest);
                formatTestDataRatio(result.sellingTest);
            }
            else {
                result.sellingTest = null;
            }

            result.hasProcessedData = result.buyingTrain != null || result.buyingTest != null || result.sellingTrain != null || result.sellingTest != null;

            res.json({ processings: result });
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