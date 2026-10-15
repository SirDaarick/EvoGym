export type KnowledgeCategory =
  | 'tariffs_promos'
  | 'schedules_classes'
  | 'regulations'
  | 'supplements_store';

export interface KnowledgeItem {
  id: string;
  title: string;
  category: KnowledgeCategory;
  content: string;
  createdAt: string;
  expiresAt: string | null;
  tags: string[];
  authorName: string;
}

export type KnowledgeStatus = 'active' | 'expiring_soon' | 'expired';

export type ContactType = 'inquiry' | 'sales' | 'customer_support' | 'internal_ops';

export type ConversationStatus = 'active' | 'resolved' | 'escalated';

export interface GimiConversation {
  id: string;
  clientName: string;
  clientPhone?: string;
  channel: 'whatsapp' | 'web';
  contactType: ContactType;
  status: ConversationStatus;
  startedAt: string;
  lastMessageAt: string;
  messagesCount: number;
  needsHumanAttention: boolean;
  summary: string;
  alertReason?: string;
}

export interface GimiAlert {
  id: string;
  conversationId: string;
  clientName: string;
  channel: 'whatsapp' | 'web';
  type: 'churn_risk' | 'unresolved_inquiry' | 'complaint' | 'high_intent_lead';
  severity: 'high' | 'medium' | 'info';
  message: string;
  timestamp: string;
  status: 'pending' | 'resolved';
}

export interface GimiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  suggestions?: string[];
  intent?: ContactType;
  actionTaken?: string;
}
