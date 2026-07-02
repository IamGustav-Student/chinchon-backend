const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth.middleware');
const c = require('../controllers/messages.controller');

router.use(auth);

router.get('/', c.getMessages);
router.get('/unread-count', c.getUnreadCount);
router.post('/', c.sendMessage);
router.put('/:id/read', c.markRead);

module.exports = router;
