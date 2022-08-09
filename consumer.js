const keys = require('./config/keys');
const amqp = require('amqplib/callback_api');
const request = require('request');
const fs = require('fs');
const StreamZip = require('node-stream-zip');
let nodeIp = '192.168.110.134'; // need to fix

function createDir(file) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(file, { recursive: true });
  }
}

function cleanUp(file) {
  if (fs.existsSync(file)) {
    fs.rmdirSync('./' + file, { recursive: true });
  }
}

async function checkStatus(message) {
  let id;
  let payload = {};
  payload.message = message;
  request.post(
    {
      url: keys.gitlaburl + keys.gitlabpipeline + keys.gitlabpipelinetoken,
      form: {
        variables: {
          NAME: message.body.name,
          ID:
            message.body.image +
            '-' +
            message.body._id,
          MODULE_NAME: message.body.image,
          REPLICAS: message.body.replicas,
          NAMESPACE: message.user,
          CUSTOMERNAME: message.user,
          VERSION: message.body.version,
          PROVIDER: message.body.provider,
          STATUS: message.body.status
        },
      },
    },
    function (error, response, body) {
      id = JSON.parse(body).id;
      console.log('id - ', id);
    }
  );
  cleanUp(message.body._id);
  createDir(message.body._id);
  await new Promise((resolve) => setTimeout(resolve, 5000));
  let success;
  let artifactValue;
  let jobId;
  try {
    request.get(
      {
        url: keys.gitlaburl + '/pipelines/' + id + '/jobs',
      },
      function (error, response, body) {
        const answer = JSON.parse(response.body);
        const pushStage = answer.filter((stages) => stages.name === 'push');
        jobId = pushStage[0].id;
      }
    );  
  } catch (error) {
    console.log('Cannot get job status')
    payload.message.body.status = 'failed';
    payload.artifact = '';
    console.log(payload);
    console.log('sending a message');
    sendMessage(payload);
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 2000));
  for (let i = 0; i <= 15; i++) {
    if (success === true || success === false) {
      console.log('job has been processed');
      break;
    }
    request.get(
      {
        url: keys.gitlaburl + '/jobs/' + jobId,
        headers: { 'PRIVATE-TOKEN': keys.gitlabtoken },
      },
      function (error, response, body) {
        let jobStatusAnswer = JSON.parse(response.body);
        console.log(`i - ${i} ; jobid - ${jobId} ; ${jobStatusAnswer.status}`)
        if (
          jobStatusAnswer.status === 'skipped' ||
          jobStatusAnswer.status === 'failed'  ||
          i == 15
        ) {
          success = false;
        }
        if (jobStatusAnswer.status === 'success') {
          success = true;
          jobStatusAnswer.status = 'processed';
          console.log('Downloading an artifact of job with id - ', jobId);
          request
            .get({
              url: `${keys.gitlaburl}/jobs/${jobId}/artifacts`,
              headers: { 'PRIVATE-TOKEN': keys.gitlabtoken },
              encoding: null,
            })
            .pipe(fs.createWriteStream(`${message.body._id}/artifact.zip`))
            .on('close', function () {
              console.log('File written!');
            });
        }
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
  if (success === false) {
    payload.message.body.status = 'failed';
    payload.artifact = '';
    console.log(payload);
    console.log('sending a message');
    sendMessage(payload);
    cleanUp(message.body._id);
    return;
  } else {
    payload.message.body.status = 'running';
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
  try {
    const zip = new StreamZip({
      file: `${message.body._id}/artifact.zip`,
      storeEntries: true,
    });
    zip.on('ready', () => {
      let zipDotTxtContents = zip.entryDataSync('output.txt').toString('utf8');
      artifactValue = zipDotTxtContents;
      payload.artifact = artifactValue;
      console.log(payload);
      console.log('sending a message');
      sendMessage(payload);
      zip.close();
      cleanUp(message.body._id);
    });
  } catch {
    payload.artifact = '';
    payload.message.body.status = 'failed';
    console.log('sending a message');
    sendMessage(payload);
  }
}

function sendMessage(payload) {
  amqp.connect(keys.amq, function (error, connection) {
    if (error) {
      console.log(error);
      res.status(500).json('the message has not been sent');
    }
    connection.createChannel((error, channel) => {
      if (error) {
        console.log(error);
      }
      let queueName = 'applicationPutStatus';
      let message = { payload: payload };
      channel.assertQueue(queueName, {
        durable: false,
      });
      channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)));
      setTimeout(() => {
        connection.close();
      }, 1000);
    });
  });
}

amqp.connect(keys.amq, function (error0, connection) {
  if (error0) {
    throw error0;
  }
  connection.createChannel((error1, channel) => {
    if (error1) {
      throw error1;
    }
    let queueName = 'applicationDeploymentRequest';
    channel.assertQueue(queueName, {
      durable: false,
    });
    channel.consume(queueName, (msg) => {
      const message = JSON.parse(msg.content.toString());
      checkStatus(message);
      console.log('MESSAGE PROCESSED');
      channel.ack(msg);
    });
  });
});
