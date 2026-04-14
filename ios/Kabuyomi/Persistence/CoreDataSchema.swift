import CoreData
import Foundation

@objc(StockEntity)
final class StockEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var ticker: String
    @NSManaged var companyName: String
    @NSManaged var cik: String
    @NSManaged var exchange: String
    @NSManaged var addedAt: Date
    @NSManaged var lastUpdatedAt: Date
    @NSManaged var filings: NSSet?
}

@objc(FilingEntity)
final class FilingEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var filingKey: String
    @NSManaged var formType: String
    @NSManaged var filedAt: Date
    @NSManaged var periodOfReport: Date
    @NSManaged var accessionNumber: String
    @NSManaged var primaryDocumentUrl: String
    @NSManaged var mdaText: String
    @NSManaged var mdaTokenCount: Int32
    @NSManaged var extractorVersion: String
    @NSManaged var promptVersion: String
    @NSManaged var stock: StockEntity?
    @NSManaged var summary: SummaryEntity?
    @NSManaged var metrics: NSSet?
    @NSManaged var sourceChunks: NSSet?
    @NSManaged var chatMessages: NSSet?
}

@objc(SummaryEntity)
final class SummaryEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var generatedAt: Date
    @NSManaged var verdictText: String
    @NSManaged var comparisonLabel: String
    @NSManaged var modelName: String
    @NSManaged var filing: FilingEntity?
    @NSManaged var items: NSSet?
}

@objc(SummaryItemEntity)
final class SummaryItemEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var kind: String
    @NSManaged var text: String
    @NSManaged var sortOrder: Int32
    @NSManaged var sourceIdsJSON: String
    @NSManaged var summary: SummaryEntity?
}

@objc(FinancialMetricEntity)
final class FinancialMetricEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var logicalName: String
    @NSManaged var tagUsed: String
    @NSManaged var value: Double
    @NSManaged var unit: String
    @NSManaged var periodEnd: Date
    @NSManaged var comparisonValue: NSNumber?
    @NSManaged var yoyPercent: NSNumber?
    @NSManaged var filing: FilingEntity?
}

@objc(SourceChunkEntity)
final class SourceChunkEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var sourceId: String
    @NSManaged var sectionType: String
    @NSManaged var sectionTitle: String
    @NSManaged var sourceLabel: String
    @NSManaged var text: String
    @NSManaged var startOffset: Int32
    @NSManaged var endOffset: Int32
    @NSManaged var tagName: String?
    @NSManaged var sortOrder: Int32
    @NSManaged var filing: FilingEntity?
    @NSManaged var messageRefs: NSSet?
}

@objc(ChatMessageEntity)
final class ChatMessageEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var role: String
    @NSManaged var content: String
    @NSManaged var createdAt: Date
    @NSManaged var modelName: String
    @NSManaged var filing: FilingEntity?
    @NSManaged var sourceRefs: NSSet?
}

@objc(MessageSourceRefEntity)
final class MessageSourceRefEntity: NSManagedObject {
    @NSManaged var id: UUID
    @NSManaged var sourceLabelSnapshot: String
    @NSManaged var excerpt: String
    @NSManaged var chatMessage: ChatMessageEntity?
    @NSManaged var sourceChunk: SourceChunkEntity?
}

extension StockEntity {
    @nonobjc static func fetchRequest() -> NSFetchRequest<StockEntity> {
        NSFetchRequest(entityName: "StockEntity")
    }

    var filingArray: [FilingEntity] {
        let set = filings as? Set<FilingEntity> ?? []
        return set.sorted { $0.filedAt > $1.filedAt }
    }
}

extension FilingEntity {
    @nonobjc static func fetchRequest() -> NSFetchRequest<FilingEntity> {
        NSFetchRequest(entityName: "FilingEntity")
    }

    var metricArray: [FinancialMetricEntity] {
        let set = metrics as? Set<FinancialMetricEntity> ?? []
        let order: [String: Int] = [
            "revenue": 0,
            "netIncome": 1,
            "epsBasic": 2,
            "operatingIncome": 3,
            "operatingCashFlow": 4
        ]

        return set.sorted {
            let left = order[$0.logicalName] ?? .max
            let right = order[$1.logicalName] ?? .max
            if left != right {
                return left < right
            }
            return $0.logicalName < $1.logicalName
        }
    }

    var sourceChunkArray: [SourceChunkEntity] {
        let set = sourceChunks as? Set<SourceChunkEntity> ?? []
        return set.sorted { $0.sortOrder < $1.sortOrder }
    }

    var chatMessageArray: [ChatMessageEntity] {
        let set = chatMessages as? Set<ChatMessageEntity> ?? []
        return set.sorted { $0.createdAt < $1.createdAt }
    }
}

extension SummaryEntity {
    @nonobjc static func fetchRequest() -> NSFetchRequest<SummaryEntity> {
        NSFetchRequest(entityName: "SummaryEntity")
    }

    var itemArray: [SummaryItemEntity] {
        let set = items as? Set<SummaryItemEntity> ?? []
        return set.sorted { $0.sortOrder < $1.sortOrder }
    }
}

extension ChatMessageEntity {
    @nonobjc static func fetchRequest() -> NSFetchRequest<ChatMessageEntity> {
        NSFetchRequest(entityName: "ChatMessageEntity")
    }

    var sourceRefArray: [MessageSourceRefEntity] {
        let set = sourceRefs as? Set<MessageSourceRefEntity> ?? []
        return set.sorted { $0.sourceLabelSnapshot < $1.sourceLabelSnapshot }
    }
}

enum CoreDataSchema {
    static func makeModel() -> NSManagedObjectModel {
        let model = NSManagedObjectModel()

        let stock = entity(name: "StockEntity", className: NSStringFromClass(StockEntity.self))
        stock.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("ticker", type: .stringAttributeType),
            attribute("companyName", type: .stringAttributeType),
            attribute("cik", type: .stringAttributeType),
            attribute("exchange", type: .stringAttributeType),
            attribute("addedAt", type: .dateAttributeType),
            attribute("lastUpdatedAt", type: .dateAttributeType)
        ]

        let filing = entity(name: "FilingEntity", className: NSStringFromClass(FilingEntity.self))
        filing.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("filingKey", type: .stringAttributeType),
            attribute("formType", type: .stringAttributeType),
            attribute("filedAt", type: .dateAttributeType),
            attribute("periodOfReport", type: .dateAttributeType),
            attribute("accessionNumber", type: .stringAttributeType),
            attribute("primaryDocumentUrl", type: .stringAttributeType),
            attribute("mdaText", type: .stringAttributeType),
            attribute("mdaTokenCount", type: .integer32AttributeType),
            attribute("extractorVersion", type: .stringAttributeType),
            attribute("promptVersion", type: .stringAttributeType)
        ]

        let summary = entity(name: "SummaryEntity", className: NSStringFromClass(SummaryEntity.self))
        summary.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("generatedAt", type: .dateAttributeType),
            attribute("verdictText", type: .stringAttributeType),
            attribute("comparisonLabel", type: .stringAttributeType),
            attribute("modelName", type: .stringAttributeType)
        ]

        let summaryItem = entity(name: "SummaryItemEntity", className: NSStringFromClass(SummaryItemEntity.self))
        summaryItem.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("kind", type: .stringAttributeType),
            attribute("text", type: .stringAttributeType),
            attribute("sortOrder", type: .integer32AttributeType),
            attribute("sourceIdsJSON", type: .stringAttributeType)
        ]

        let metric = entity(name: "FinancialMetricEntity", className: NSStringFromClass(FinancialMetricEntity.self))
        metric.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("logicalName", type: .stringAttributeType),
            attribute("tagUsed", type: .stringAttributeType),
            attribute("value", type: .doubleAttributeType),
            attribute("unit", type: .stringAttributeType),
            attribute("periodEnd", type: .dateAttributeType),
            attribute("comparisonValue", type: .doubleAttributeType, optional: true),
            attribute("yoyPercent", type: .doubleAttributeType, optional: true)
        ]

        let sourceChunk = entity(name: "SourceChunkEntity", className: NSStringFromClass(SourceChunkEntity.self))
        sourceChunk.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("sourceId", type: .stringAttributeType),
            attribute("sectionType", type: .stringAttributeType),
            attribute("sectionTitle", type: .stringAttributeType),
            attribute("sourceLabel", type: .stringAttributeType),
            attribute("text", type: .stringAttributeType),
            attribute("startOffset", type: .integer32AttributeType),
            attribute("endOffset", type: .integer32AttributeType),
            attribute("tagName", type: .stringAttributeType, optional: true),
            attribute("sortOrder", type: .integer32AttributeType)
        ]

        let chatMessage = entity(name: "ChatMessageEntity", className: NSStringFromClass(ChatMessageEntity.self))
        chatMessage.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("role", type: .stringAttributeType),
            attribute("content", type: .stringAttributeType),
            attribute("createdAt", type: .dateAttributeType),
            attribute("modelName", type: .stringAttributeType)
        ]

        let messageSourceRef = entity(name: "MessageSourceRefEntity", className: NSStringFromClass(MessageSourceRefEntity.self))
        messageSourceRef.properties = [
            attribute("id", type: .UUIDAttributeType),
            attribute("sourceLabelSnapshot", type: .stringAttributeType),
            attribute("excerpt", type: .stringAttributeType)
        ]

        let stockFilings = relationship("filings", destination: filing, toMany: true, deleteRule: .cascadeDeleteRule)
        let filingStock = relationship("stock", destination: stock, toMany: false, deleteRule: .nullifyDeleteRule)
        stockFilings.inverseRelationship = filingStock
        filingStock.inverseRelationship = stockFilings

        let filingSummary = relationship("summary", destination: summary, toMany: false, deleteRule: .cascadeDeleteRule)
        let summaryFiling = relationship("filing", destination: filing, toMany: false, deleteRule: .nullifyDeleteRule)
        filingSummary.inverseRelationship = summaryFiling
        summaryFiling.inverseRelationship = filingSummary

        let filingMetrics = relationship("metrics", destination: metric, toMany: true, deleteRule: .cascadeDeleteRule)
        let metricFiling = relationship("filing", destination: filing, toMany: false, deleteRule: .nullifyDeleteRule)
        filingMetrics.inverseRelationship = metricFiling
        metricFiling.inverseRelationship = filingMetrics

        let filingChunks = relationship("sourceChunks", destination: sourceChunk, toMany: true, deleteRule: .cascadeDeleteRule)
        let chunkFiling = relationship("filing", destination: filing, toMany: false, deleteRule: .nullifyDeleteRule)
        filingChunks.inverseRelationship = chunkFiling
        chunkFiling.inverseRelationship = filingChunks

        let filingChats = relationship("chatMessages", destination: chatMessage, toMany: true, deleteRule: .cascadeDeleteRule)
        let chatFiling = relationship("filing", destination: filing, toMany: false, deleteRule: .nullifyDeleteRule)
        filingChats.inverseRelationship = chatFiling
        chatFiling.inverseRelationship = filingChats

        let summaryItems = relationship("items", destination: summaryItem, toMany: true, deleteRule: .cascadeDeleteRule)
        let itemSummary = relationship("summary", destination: summary, toMany: false, deleteRule: .nullifyDeleteRule)
        summaryItems.inverseRelationship = itemSummary
        itemSummary.inverseRelationship = summaryItems

        let chatSourceRefs = relationship("sourceRefs", destination: messageSourceRef, toMany: true, deleteRule: .cascadeDeleteRule)
        let refChat = relationship("chatMessage", destination: chatMessage, toMany: false, deleteRule: .nullifyDeleteRule)
        chatSourceRefs.inverseRelationship = refChat
        refChat.inverseRelationship = chatSourceRefs

        let chunkMessageRefs = relationship("messageRefs", destination: messageSourceRef, toMany: true, deleteRule: .nullifyDeleteRule)
        let refChunk = relationship("sourceChunk", destination: sourceChunk, toMany: false, deleteRule: .nullifyDeleteRule)
        chunkMessageRefs.inverseRelationship = refChunk
        refChunk.inverseRelationship = chunkMessageRefs

        stock.properties.append(stockFilings)
        filing.properties.append(contentsOf: [filingStock, filingSummary, filingMetrics, filingChunks, filingChats])
        summary.properties.append(contentsOf: [summaryFiling, summaryItems])
        summaryItem.properties.append(itemSummary)
        metric.properties.append(metricFiling)
        sourceChunk.properties.append(contentsOf: [chunkFiling, chunkMessageRefs])
        chatMessage.properties.append(contentsOf: [chatFiling, chatSourceRefs])
        messageSourceRef.properties.append(contentsOf: [refChat, refChunk])

        model.entities = [stock, filing, summary, summaryItem, metric, sourceChunk, chatMessage, messageSourceRef]
        return model
    }

    private static func entity(name: String, className: String) -> NSEntityDescription {
        let description = NSEntityDescription()
        description.name = name
        description.managedObjectClassName = className
        return description
    }

    private static func attribute(
        _ name: String,
        type: NSAttributeType,
        optional: Bool = false
    ) -> NSAttributeDescription {
        let description = NSAttributeDescription()
        description.name = name
        description.attributeType = type
        description.isOptional = optional
        return description
    }

    private static func relationship(
        _ name: String,
        destination: NSEntityDescription,
        toMany: Bool,
        deleteRule: NSDeleteRule
    ) -> NSRelationshipDescription {
        let description = NSRelationshipDescription()
        description.name = name
        description.destinationEntity = destination
        description.minCount = 0
        description.maxCount = toMany ? 0 : 1
        description.deleteRule = deleteRule
        description.isOptional = true
        return description
    }
}
