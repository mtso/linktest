const express = require('express');
const multer = require('multer');
const path = require('path');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const unzip = require('unzip');
const fs = require('fs');
const nodegit = require('nodegit');
const fse = require('fse');
const ncp = require('ncp');

const api = module.exports = express.Router();

const namespaceDir = (namespace) => path.resolve(__dirname, `./.data/${namespace}`);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const namespace = req.query.username;
    const saveDir = namespaceDir(namespace);
    
    mkdirp(saveDir, (err) => {
      cb(err, saveDir);
    })
  },
  filename: function (req, file, cb) {
    console.log(req.query)
    cb(null, 'source.zip');
  },
});

const upload = multer({ storage });

api.post('/push', upload.single('source'), (req, res, next) => {
  // unzip
  const namespace = req.query.username;
  const nspDir = namespaceDir(namespace);
  const archivePath = path.join(nspDir, 'source.zip');
  const sourcePath = path.join(nspDir, '/source/');
  
  rimraf(sourcePath, (err) => {
    if (err) return next(err);
    
    fs.createReadStream(archivePath).pipe(unzip.Extract({
      path: sourcePath,
    })).on('error', () => {
      res.status(400).json({ message: 'Could not unzip source.zip' });
    }).on('finish', next);
  });
}, (req, res, next) => {
  // push repo
  // 1. if repo doesn't exist
  // 2. try to pull repo
  //
  
  const namespace = req.query.username;
  const nspDir = namespaceDir(namespace);
  const repoUrl = req.query.repo_url;
  const branch = req.query.branch;
  const username = req.query.username;
  const password = req.query.password;
  const email = req.query.email;
  const commitMessage = req.query.commit_message;
  
  const gitPath = path.join(nspDir, '/git/');
  const sourcePath = path.join(nspDir, '/source/');
  
  const signature = nodegit.Signature.create(
    username,
    email,
    Date.now() / 1000,
    0
  );
  
  const opts = {
    checkoutBranch: branch,
    fetchOpts: {
      callbacks: {
        credentials: function() {
          console.log(username, password)
          return nodegit.Cred.userpassPlaintextNew(username, password);
        },
        certificateCheck: () => 1,
      }
    }
  };
  
  
  let repository;
  
  const tempBranch = 'push-' + Date.now();
  
  (new Promise((resolve, reject) => rimraf(gitPath, (err) => {
    if (err) return reject(err);
    resolve()
  })))

  .then(() => {
    return nodegit.Clone(repoUrl, gitPath, opts)
  })
  .then((repo) => {
    repository = repo;
    
    return repo.getHeadCommit().then((commit) => {
      return repo.createBranch(tempBranch, commit, 1)
    })

    .then((ref) => repo.checkoutRef(ref))
    .then(() => {

      return new Promise((resolve, reject) => {
        ncp(sourcePath, gitPath, (err) => {
          if (err) return reject(err);
          resolve();
        })
      })

    })

  })
  .then(() => repository.refreshIndex())
  .then((index) => {
    // FIXME, add only changed filepaths

    return index.addAll('.', 0, (path) => {
      console.log('index:', path);
      return 0; // means to add...?
    }, null)

    .then(() => index.write())
    .then(() => index.writeTree());
  })

  .then((oid) => {
    
    // Blindly add all
    return fse.readdir(gitPath).then((dirs) => {
      dirs = dirs.filter((d) => d !== '.git')
      return repository.createCommitOnHead(dirs, signature, signature, commitMessage);
    // return repository.createCommit('HEAD', signature, signature,
    //                                commitMessage, oid, []);
    })
  })
  
  .then(() => {
    // return nodegit.Remote.create(repository, 'origin', repoUrl)
      return repository.getRemote('origin').then((remote) => {
        return remote.push(
          [`refs/heads/${tempBranch}:refs/heads/${branch}`],
          opts.fetchOpts
        );
      });
    
  })
  
  .then(() => next())

  .catch(err => next(err));
  
}, (req, res, next) => {
  // respond success
  const response = Object.assign({}, {
    message: 'ok',
    isUploaded: !!req.file,
  }, req.query);
  
  res.json(response);
});
