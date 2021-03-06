'use strict';
module.exports = {
    up: (queryInterface, Sequelize, onDone) => {
        return queryInterface.sequelize.query("SELECT CONSTRAINT_NAME AS name FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_NAME = 'weights' AND CONSTRAINT_TYPE='FOREIGN KEY'")
            .then(names => {

                let name = "weights_ibfk_1";

                function create() {
                    console.log("Create " + name);
                    return queryInterface.sequelize.query("ALTER TABLE weights ADD CONSTRAINT " + name + " FOREIGN KEY (Instrument_ID) REFERENCES instruments (ID) ON DELETE CASCADE")
                        .then(x => onDone());
                }

                if (names && names.length > 0 && names[0].length > 0 && names[0][0].name) {
                    name = names[0][0].name;
                    console.log("Drop " + names[0][0].name);
                    return queryInterface.sequelize.query("ALTER TABLE weights DROP FOREIGN KEY " + name)
                        .then(create);
                }
                else {
                    return create();
                }
            });
    },
    down: (queryInterface, Sequelize, onDone) => {
        return queryInterface.sequelize.query("SELECT CONSTRAINT_NAME AS name FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_NAME = 'weights' AND CONSTRAINT_TYPE='FOREIGN KEY'")
            .then(names => {

                let name = "weights_ibfk_1";

                function create() {
                    console.log("Create " + name);
                    return queryInterface.sequelize.query("ALTER TABLE weights ADD CONSTRAINT " + name + " FOREIGN KEY (Instrument_ID) REFERENCES instruments (ID) ON DELETE RESTRICT")
                        .then(x => onDone());
                }

                if (names && names.length > 0 && names[0].length > 0 && names[0][0].name) {
                    name = names[0][0].name;
                    console.log("Drop " + name);
                    return queryInterface.sequelize.query("ALTER TABLE weights DROP FOREIGN KEY " + name)
                        .then(create);
                }
                else {
                    console.log("existing: " + JSON.stringify(names));
                    return create();
                }
            });
    }
};