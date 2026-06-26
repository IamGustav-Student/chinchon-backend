const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const { listTables, createTable, joinTable, getTable } = require('../controllers/game.controller');

router.get('/list', auth, listTables);
router.post('/create', auth, createTable);
router.post('/join/:id', auth, joinTable);
router.get('/:id', auth, getTable);

module.exports = router;
