var exports = module.exports = {}
var model = require('../models/index');
var sequelize = require('sequelize');
var sql = require('../sql/sql');
var fs = require('fs');
var config = require('../config/envconfig');
var splitJob = require('./split');
var consolidateJob = require('./consolidate');
var newSnapshotController = require('../controllers/new_snapshot_controller');

var duplicates_sql = "";
try {
    duplicates_sql = fs.readFileSync(__dirname + '/../sql/duplicates.sql', 'utf8');
} catch (e) {
    console.log('Error:', e.stack);
}

var missing_rates_sql = "";
try {
    missing_rates_sql = fs.readFileSync(__dirname + '/../sql/missing_rates.sql', 'utf8');
} catch (e) {
    console.log('Error:', e.stack);
}

var late_rates_sql = "";
try {
    late_rates_sql = fs.readFileSync(__dirname + '/../sql/late_rates.sql', 'utf8');
} catch (e) {
    console.log('Error:', e.stack);
}


function sleep(ms) {
    return new Promise((resolve, reject) => {
        try {
            setTimeout(resolve, ms);
        }
        catch (e) {
            reject(e);
        }
    });
}

function groupBy(xs, key, equals) {
    return xs.reduce(function (rv, x) {
        let v = key(x);
        let el = rv.find((r) => r && equals(r.key, v));
        if (el) {
            el.values.push(x);
        } else {
            rv.push({ key: v, values: [x] });
        } return rv;
    }, []);
}

async function cleanupDuplicates() {
    var rows = await sql.query(duplicates_sql, {});

    var groups = groupBy(rows, x => {
        return {
            Instrument_ID: x.Instrument_ID,
            Time: x.Time
        };
    }, (a, b) => {
        return a.Instrument_ID == b.Instrument_ID && a.Time.substr(0, 10) == b.Time.substr(0, 10);
    });

    for (var i = 0; i < groups.length; ++i) {

        var snapshots = groups[i].values;

        for (var i = 1; i < snapshots.length; ++i) {
            console.log("deleting duplicate snapshot " + snapshots[i].ID + " for instrument " + snapshots[i].Instrument_ID);
            await model.usersnapshot.update(
                {
                    Snapshot_ID: snapshots[0].ID
                },
                {
                    where: {
                        Snapshot_ID: snapshots[i].ID
                    }
                });
            await model.trade.update(
                {
                    Snapshot_ID: snapshots[0].ID
                },
                {
                    where: {
                        Snapshot_ID: snapshots[i].ID
                    }
                });
            await model.snapshot.destroy({
                where: {
                    ID: snapshots[i].ID
                }
            });
        }
    }
}

async function cleanupMissingRates() {
    return;
    var rows = await sql.query(missing_rates_sql, {
        "@minRates": newSnapshotController.minDays - 1
    });

    for (var i = 0; i < rows.length; ++i) {
        console.log("snapshot " + rows[i].ID + " for instrument " + rows[i].Instrument_ID + " has missing rates in time span");
        /*await model.snapshot.destroy({
            where: {
                ID: rows[i].ID
            }
        });*/
    }
}

async function cleanupLateBegin() {
    return;
    var rows = await sql.query(late_rates_sql, {
        "@minDays": (config.chart_period_seconds - config.discard_threshold_seconds) / 60 / 60 / 24 - 1
    });

    for (var i = 0; i < rows.length; ++i) {
        console.log("snapshot " + rows[i].ID + " for instrument " + rows[i].Instrument_ID + " first rate is late");
        /*await model.snapshot.destroy({
            where: {
                ID: rows[i].ID
            }
        });*/
    }
}

async function cleanupOldUnseen() {
    var result = await sql.query("DELETE FROM s USING snapshots AS s WHERE NOT EXISTS (SELECT 1 FROM usersnapshots AS u WHERE u.Snapshot_ID = s.ID) AND s.Time < NOW() - INTERVAL @hours HOUR", {
        "@hours": config.max_unused_snapshot_age_hours + 1
    });

    if (result.affectedRows > 0) {
        console.log("Deleted " + result.affectedRows + " unused snapshots");
    }
}

async function cleanupDuplicateInstruments() {
    var items = await sql.select('select i.ID as dup, i2.ID as orig, i.InstrumentName \
        from instruments i \
        inner join instruments i2 on i2.ID<i.ID \
        inner join sources s on s.Instrument_ID=i.ID and s.SourceType=\'w\' \
        inner join sources s2 on s2.Instrument_ID=i2.ID and s2.SourceType=\'w\' \
        and i2.InstrumentName=i.InstrumentName \
        and s.SourceId=s2.SourceId');
        
    console.log("Cleanup job will delete " + items.length + " duplicate instruments...");

    for(var item of items) {
        await sql.select('delete from userinstruments u where u.Instrument_ID = @oldId', {
            '@oldId': item.dup
        });
        
        await sql.select('update snapshots s set s.Instrument_ID = @newId where s.Instrument_ID = @oldId', {
            '@newId': item.orig,
            '@oldId': item.dup
        });
        
        await sql.select('delete from instrumentrates r where r.Instrument_ID = @oldId', {
            '@oldId': item.dup
        });
        
        await sql.select('delete from sources s where s.Instrument_ID = @oldId', {
            '@oldId': item.dup
        });
        
        await sql.select('delete from weights w where w.Instrument_ID = @oldId', {
            '@oldId': item.dup
        });
        
        await sql.select('delete from instruments i where i.ID = @oldId', {
            '@oldId': item.dup
        });
    }
    
    console.log("Cleanup job deleted " + items.length + " duplicate instruments.");
}

exports.run = async function () {
    try {

        while (consolidateJob.isRunning || splitJob.isRunning) {
            await sleep(1000);
        }

        exports.isRunning = true;
        await cleanupDuplicates();
        await cleanupMissingRates();
        await cleanupLateBegin();
        await cleanupOldUnseen();
        await cleanupDuplicateInstruments();

    }
    catch (error) {
        console.log("error in cleanup: " + error.message + "\n" + error.stack);
    }
    finally {
        exports.isRunning = false;
    }

    setTimeout(exports.run, config.job_cleanup_interval_seconds * 1000);
};