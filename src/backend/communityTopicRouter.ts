import { Router, Request, Response } from 'express';
import { communityTopicEngine } from './topicHierarchyEngine';

/**
 * Step 4 Express Router (`/api/community-topics/*`)
 * Exposes endpoints for:
 * 1. Nested Slash-Based Topic Hierarchy (`/category/topic/subtopic/nested-subtopic`)
 * 2. Dynamic Telegram Supergroup Chatroom Creation & Dialog-to-Subtopic Mapping
 * 3. Invite Code / Link lookup & Community Access Rules presentation
 * 4. Fast Header Search by full topic path, subtopic tags, or keywords
 */
export function createCommunityTopicRouter(): Router {
  const router = Router();

  // 1. Get Nested Topic Hierarchy Tree (`/category/topic/subtopic/nested-subtopic`)
  router.get('/tree', async (req: Request, res: Response) => {
    try {
      const parentPath = req.query.parentPath ? String(req.query.parentPath) : undefined;
      const nodes = await communityTopicEngine.getTopicTree(parentPath);
      res.json({ ok: true, count: nodes.length, nodes });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 2. Create / Register a Nested Slash Topic Path
  router.post('/tree', async (req: Request, res: Response) => {
    try {
      const { topicPath, tags, description } = req.body;
      if (!topicPath) {
        res.status(400).json({ ok: false, error: 'topicPath (e.g. /category/topic/subtopic) is required.' });
        return;
      }
      const node = await communityTopicEngine.ensureTopicHierarchyPath(
        String(topicPath),
        Array.isArray(tags) ? tags : [],
        String(description || '')
      );
      res.json({ ok: true, node });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 3. Fast Topic Feed & Header Search (by full topic path, subtopic tag, or keyword)
  router.get('/chatrooms/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q ? String(req.query.q) : undefined;
      const topicPathPrefix = req.query.topicPath ? String(req.query.topicPath) : undefined;
      const tag = req.query.tag ? String(req.query.tag) : undefined;
      const inviteCode = req.query.inviteCode ? String(req.query.inviteCode) : undefined;
      const requesterUserId = req.query.userId ? String(req.query.userId) : undefined;

      const chatrooms = await communityTopicEngine.searchChatrooms({
        query,
        topicPathPrefix,
        tag,
        inviteCode,
        requesterUserId,
      });

      res.json({
        ok: true,
        count: chatrooms.length,
        chatrooms,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 4. Create Chatroom -> Creates Telegram Supergroup via GramJS & Maps Dialog ID to Subtopic ID
  router.post('/chatrooms', async (req: Request, res: Response) => {
    try {
      const {
        title,
        description,
        topicPath,
        visibility,
        rules,
        tags,
        hostId,
        hostName,
      } = req.body;

      if (!title || !topicPath) {
        res.status(400).json({
          ok: false,
          error: 'Both title and slash-based topicPath are required.',
        });
        return;
      }

      const appBaseUrl = `${req.protocol}://${req.get('host')}`;
      const chatroom = await communityTopicEngine.createSupergroupChatroom({
        title: String(title),
        description: description ? String(description) : '',
        topicPath: String(topicPath),
        visibility: visibility === 'private' ? 'private' : 'public',
        rules: Array.isArray(rules) ? rules : [],
        tags: Array.isArray(tags) ? tags : [],
        hostId: String(hostId || 'tg-local-host'),
        hostName: String(hostName || 'Host'),
        appBaseUrl,
      });

      res.json({ ok: true, chatroom });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  // 5. Inspect Invite Code / Link & Fetch Custom Community Rules before Joining
  router.get('/chatrooms/invite/:code', async (req: Request, res: Response) => {
    try {
      const chatroom = await communityTopicEngine.getChatroomByInviteOrId(req.params.code);
      if (!chatroom) {
        res.status(404).json({ ok: false, error: 'Invalid or expired invite code.' });
        return;
      }
      res.json({
        ok: true,
        chatroom,
        accessRulesPrompt: {
          roomId: chatroom.roomId,
          telegramDialogId: chatroom.telegramDialogId,
          subtopicId: chatroom.subtopicId,
          topicPath: chatroom.topicPath,
          title: chatroom.title,
          rules: chatroom.rules,
          requiresRuleAcceptance: true,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  return router;
}
