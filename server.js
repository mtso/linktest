// server.js
// where your node app starts

// init project
const express = require('express')
const app = express()

const api = require('./api');

app.set('json spaces', 2);
app.use('/api', api);

// listen for requests :)
const listener = app.listen(process.env.PORT, () => {
  console.log(`Your app is listening on port ${listener.address().port}`)
})
