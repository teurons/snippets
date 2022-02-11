const { Repeater } = require("@repeaterjs/repeater");

var dotenv = require("dotenv");
dotenv.config({ path: process.env.ENVFILE });

const { exec } = require("child_process");
const fs = require("fs-extra");

const branchName = `deploy${new Date().getTime()}`;
// const branchName = `deploy1644595879361`;
var deployRequestNumber = 0;

const createKnexBranchClient = (pickedCredentials) => {
  const mysqlKnex = require("knex")({
    client: "mysql2",
    debug: false,
    connection: {
      host: pickedCredentials.DB_HOST,
      port: 3306,
      user: pickedCredentials.DB_USERNAME,
      password: pickedCredentials.DB_PASSWORD,
      database: "backend_neptune",
      ssl: {
        ca: fs.readFileSync(__dirname + "/../../cacert.pem"),
        rejectUnauthorized: false,
      },
    },
    migrations: {
      directory: "./database/migrations",
      tableName: "migrations",
    },
  });

  return mysqlKnex;
};

const createKnexMainClient = () => {
  const mysqlKnex = require("knex")({
    client: "mysql2",
    debug: false,
    connection: {
      host: process.env.DB_HOST,
      port: 3306,
      user: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: "backend_neptune",
      ssl: {
        ca: fs.readFileSync(__dirname + "/../../cacert.pem"),
        rejectUnauthorized: false,
      },
    },
    migrations: {
      directory: "./database/migrations",
      tableName: "migrations",
    },
  });

  return mysqlKnex;
};

const buildWithAuth = (cmd) => {
  return `${cmd} --service-token ${process.env.PLANETSCALE_TOKEN} --service-token-id ${process.env.PLANETSCALE_TOKEN_NAME} --org ${process.env.PLANETSCALE_ORG} --format json`;
};

const dumpMigrationsFromMain = () => {
  return `mysqldump --user ${process.env.DB_USERNAME} -h ${process.env.DB_HOST} -p${process.env.DB_PASSWORD}  ${process.env.DB_NAME} migrations --no-create-info --compact --skip-triggers --set-gtid-purged=OFF > main_migrations.sql`;
};

const importMigrationsIntoMain = () => {
  return `mysql --user ${process.env.DB_USERNAME} -h ${process.env.DB_HOST} -p${process.env.DB_PASSWORD} --database ${process.env.DB_NAME} < branch_migrations.sql`;
};

const importMigrationsIntoBranch = (credentials) => {
  return `mysql --user ${credentials.DB_USERNAME} -h ${credentials.DB_HOST} -p${credentials.DB_PASSWORD} --database ${credentials.DB_NAME} < main_migrations.sql`;
};

const dumpMigrationsFromBranch = (credentials) => {
  return `mysqldump --user ${credentials.DB_USERNAME} -h ${credentials.DB_HOST} -p${credentials.DB_PASSWORD}  ${credentials.DB_NAME} migrations --no-create-info --compact --skip-triggers --set-gtid-purged=OFF > branch_migrations.sql`;
};

const createDeployRequest = () => {
  return buildWithAuth(
    `pscale deploy-request create ${process.env.PLANETSCALE_DB} ${branchName}`
  );
};

const deployDeployRequest = (number) => {
  return buildWithAuth(
    `pscale deploy-request deploy ${process.env.PLANETSCALE_DB} ${deployRequestNumber}`
  );
};

const createPassword = () => {
  return buildWithAuth(
    `pscale password create ${
      process.env.PLANETSCALE_DB
    } ${branchName} migrator${new Date().getTime()}`
  );
};

const deleteBranch = () => {
  return buildWithAuth(
    `pscale branch delete ${process.env.PLANETSCALE_DB} ${branchName} --force`
  );
};

const createBranch = () => {
  return buildWithAuth(
    `pscale branch create ${process.env.PLANETSCALE_DB} ${branchName} --from main`
  );
};

const branchStatus = (branch) => {
  return buildWithAuth(
    `pscale branch show ${process.env.PLANETSCALE_DB} ${branch}`
  );
};

const executeCmd = (cmd, json = true) => {
  console.log("Running cmd", cmd);

  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      }
      if (stderr) {
        reject(error);
      }

      if (json) {
        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          resolve(stdout);
        }
      } else {
        resolve(stdout);
      }
    });
  });
};

const deployRequestStatus = (branch) => {
  return buildWithAuth(
    `pscale deploy-request show ${process.env.PLANETSCALE_DB} ${deployRequestNumber}`
  );
};

const branch_statuses = new Repeater(async (push, stop) => {
  const result = await executeCmd(branchStatus(branchName));
  push(result.ready);

  const interval = setInterval(async () => {
    const result = await executeCmd(branchStatus(branchName));
    push(result.ready);
  }, 10000);

  await stop;
  clearInterval(interval);
});

const deploy_requests = new Repeater(async (push, stop) => {
  const result = await executeCmd(deployRequestStatus());
  push(result);

  const interval = setInterval(async () => {
    const result = await executeCmd(deployRequestStatus());
    push(result);
  }, 5000);

  await stop;
  clearInterval(interval);
});

const deployment_requests = new Repeater(async (push, stop) => {
  const result = await executeCmd(deployRequestStatus());
  push(result);

  const interval = setInterval(async () => {
    const result = await executeCmd(deployRequestStatus());
    push(result);
  }, 5000);

  await stop;
  clearInterval(interval);
});

(async function () {
  let branchKnex;
  let mainKnex;
  try {
    const result = await executeCmd(createBranch());
    console.log(result);

    for await (const branch_status of branch_statuses) {
      console.log("branch_status:", branch_status);
      if (branch_status === true) {
        console.log("Branch is ready");
        break; // closes the socket
      }
    }

    const credentials = await executeCmd(createPassword());

    const pickedCredentials = {
      DB_USERNAME: credentials.id,
      DB_PASSWORD: credentials.plain_text,
      DB_NAME: process.env.PLANETSCALE_DB,
      DB_HOST: credentials["database_branch"]["access_host_url"],
    };

    mainKnex = createKnexMainClient();
    branchKnex = createKnexBranchClient(pickedCredentials);
    await branchKnex("migrations").truncate();

    console.log("Created Password to connect to new branch", pickedCredentials);

    let migrationRowsFromMain = await mainKnex("migrations").select("*");

    console.log("migrationRowsFromMain", migrationRowsFromMain.length);

    await branchKnex.batchInsert("migrations", migrationRowsFromMain, 50);

    await branchKnex.migrate.latest();
    // await branchKnex.migrate.rollback();

    let migrationRowsFromBranch = await branchKnex("migrations").select("*");

    console.log("migrationRowsFromBranch", migrationRowsFromBranch.length);

    console.log("Let's copy migrations table now");

    await mainKnex("migrations").delete();
    await mainKnex.batchInsert("migrations", migrationRowsFromBranch, 50);

    const deployRequest = await executeCmd(createDeployRequest());
    console.log("deployRequest", deployRequest);
    deployRequestNumber = deployRequest.number;

    for await (const deploy_request of deploy_requests) {
      console.log(
        "deploy_request:",
        deploy_request.deployment.deployable,
        deploy_request.deployment.state
      );
      if (deploy_request.deployment.deployable === true) {
        console.log("Deploy request is ready");
        break; // closes the socket
      }
    }

    await executeCmd(deployDeployRequest());

    for await (const deployment_request of deployment_requests) {
      console.log(
        "deployment_request:",
        deployment_request.deployment.deployable,
        deployment_request.deployment.state
      );
      if (deployment_request.deployment.state === "complete") {
        console.log("Deployed");
        break; // closes the socket
      }
    }

    let branchDeletion = await executeCmd(deleteBranch());

    console.log("Deleted branch", branchDeletion);
  } catch (error) {
    console.log("error", error);
  } finally {
    await branchKnex.destroy();
    await mainKnex.destroy();
  }
})();
